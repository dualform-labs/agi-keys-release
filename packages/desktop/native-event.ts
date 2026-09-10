export interface NativeMapping {
  asarHash: string;
  keys: string[];
}

export interface NativeHostEvent {
  key?: string;
  act?: number;
  slot?: number;
  threadKey?: string;
  angle?: number;
  distance?: number;
}

export interface ValidatedNativeEvent {
  event: NativeHostEvent;
  type: 'codex-micro-hid-event' | 'codex-micro-joystick-event';
}

export function validateNativeEvent(
  commandId: string,
  args: Record<string, unknown>,
  mapping: NativeMapping | undefined,
  expectedAsarHash: string,
): ValidatedNativeEvent {
  if (commandId === 'native.key') {
    const key = String(args.key);
    if (
      key.startsWith('ACT')
      && (!mapping || mapping.asarHash !== expectedAsarHash || !mapping.keys.includes(key))
    ) {
      throw Error('Native ACT mapping calibration required');
    }
    if (!/^(AG0[0-5]|ACT0[6-9]|ACT1[0-2]|ENC_CLK)$/.test(key) || ![0, 1].includes(Number(args.act))) {
      throw Error('Invalid native key event');
    }

    const event: NativeHostEvent = { key, act: Number(args.act) };
    if (key.startsWith('AG')) {
      event.slot = Number(key.slice(2));
      if (typeof args.threadKey !== 'string') throw Error('Exact slot threadKey required');
      event.threadKey = args.threadKey;
    }
    return { event, type: 'codex-micro-hid-event' };
  }

  if (commandId === 'native.encoder') {
    const key = String(args.key);
    if (!['ENC_CW', 'ENC_CC'].includes(key)) throw Error('Invalid encoder');
    return { event: { key: args.key as string, act: 2 }, type: 'codex-micro-hid-event' };
  }

  if (commandId === 'native.joystick') {
    if (
      typeof args.angle !== 'number'
      || !Number.isFinite(args.angle)
      || typeof args.distance !== 'number'
      || args.distance < 0
      || args.distance > 1
    ) {
      throw Error('Invalid joystick');
    }
    return {
      event: { angle: args.angle, distance: args.distance },
      type: 'codex-micro-joystick-event',
    };
  }

  throw Error('Unsupported native command');
}
