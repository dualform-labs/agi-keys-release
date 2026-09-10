export interface ObjectSpan {
  start: number;
  end: number;
  text: string;
}

export interface PropertyValue {
  name: string;
  value: string;
}

export function quoteEnd(text: string, start: number): number {
  const quote = text[start];
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === '\\') {
      index += 1;
      continue;
    }
    if (text[index] === quote) return index;
  }
  throw new Error(`Unterminated ${quote} literal at source offset ${start}`);
}

/**
 * Find a matching delimiter while treating renderer strings as opaque.
 * This intentionally does not parse/evaluate JavaScript expressions.
 */
export function matchingDelimiter(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (character === '`' || character === '"' || character === "'") {
      index = quoteEnd(text, index);
      continue;
    }
    if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`No matching ${close} for source offset ${start}`);
}

export function arrayObjects(text: string, arrayStart: number): ObjectSpan[] {
  const arrayEnd = matchingDelimiter(text, arrayStart, '[', ']');
  const objects: ObjectSpan[] = [];
  let index = arrayStart + 1;
  let nested = 0;
  while (index < arrayEnd) {
    const character = text[index];
    if (character === '`' || character === '"' || character === "'") {
      index = quoteEnd(text, index) + 1;
      continue;
    }
    if (character === '{') {
      if (nested === 0) {
        const objectEnd = matchingDelimiter(text, index, '{', '}');
        objects.push({ start: index, end: objectEnd + 1, text: text.slice(index, objectEnd + 1) });
        index = objectEnd + 1;
        continue;
      }
      nested += 1;
    } else if (character === '}') {
      nested -= 1;
    }
    index += 1;
  }
  return objects;
}

/** Split one known object literal into top-level property values. */
export function topLevelProperties(objectText: string): PropertyValue[] {
  if (!objectText.startsWith('{') || !objectText.endsWith('}')) return [];
  const properties: PropertyValue[] = [];
  let index = 1;
  while (index < objectText.length - 1) {
    while (index < objectText.length - 1 && /[\s,]/.test(objectText[index] ?? '')) index += 1;
    if (index >= objectText.length - 1) break;

    const keyStart = index;
    while (index < objectText.length - 1 && /[A-Za-z0-9_$]/.test(objectText[index] ?? '')) index += 1;
    const name = objectText.slice(keyStart, index);
    if (!name || objectText[index] !== ':') {
      // Unknown syntax (for example a spread) is deliberately skipped. We do
      // not guess at dynamic values in the minified renderer.
      while (index < objectText.length - 1 && objectText[index] !== ',') index += 1;
      continue;
    }
    index += 1;
    const valueStart = index;
    let curly = 0;
    let square = 0;
    let paren = 0;
    while (index < objectText.length - 1) {
      const character = objectText[index];
      if (character === '`' || character === '"' || character === "'") {
        index = quoteEnd(objectText, index) + 1;
        continue;
      }
      if (character === '{') curly += 1;
      else if (character === '}') curly -= 1;
      else if (character === '[') square += 1;
      else if (character === ']') square -= 1;
      else if (character === '(') paren += 1;
      else if (character === ')') paren -= 1;
      else if (character === ',' && curly === 0 && square === 0 && paren === 0) break;
      index += 1;
    }
    properties.push({ name, value: objectText.slice(valueStart, index).trim() });
    if (objectText[index] === ',') index += 1;
  }
  return properties;
}

export function property(properties: PropertyValue[], name: string): string | undefined {
  return properties.find((entry) => entry.name === name)?.value;
}

export function literal(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^`((?:\\.|[^`])*)`$/.exec(value.trim());
  return match ? match[1].replace(/\\([`\\])/g, '$1') : null;
}

export function literalList(value: string | undefined): string[] | null {
  if (!value?.startsWith('[') || !value.endsWith(']')) return null;
  return [...value.matchAll(/`((?:\\.|[^`])*)`/g)].map((match) => match[1].replace(/\\([`\\])/g, '$1'));
}

export function keybindingList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const values = [...value.matchAll(/\bkey:`((?:\\.|[^`])*)`/g)].map((match) =>
    match[1].replace(/\\([`\\])/g, '$1'),
  );
  return values.length > 0 ? values : undefined;
}
