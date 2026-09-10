(() => {
  const modifiers = new Set(["MetaLeft", "MetaRight", "AltLeft", "AltRight", "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight"]);
  const supported = code => modifiers.has(code) || /^(Key[A-Z]|Digit[0-9]|Space|Enter|F(?:[1-9]|1[0-2]))$/.test(code);
  function create(commit, report) {
    let active = false, held = new Set(), candidate;
    function cancel() { active = false; held.clear(); candidate = undefined; }
    return {
      start() { cancel(); active = true; }, cancel,
      get active() { return active; },
      keydown(event) {
        if (!active) return;
        event.preventDefault(); event.stopPropagation();
        if (event.code === "Escape") { cancel(); report("cancelled"); return; }
        if (event.repeat) return;
        if (!supported(event.code)) { candidate = undefined; report("unsupported"); return; }
        if (modifiers.has(event.code)) held.add(event.code);
        // Modifier flags without a captured side cannot be registered faithfully.
        const missing = [["metaKey", "Meta"], ["altKey", "Alt"], ["ctrlKey", "Control"], ["shiftKey", "Shift"]]
          .some(([flag, prefix]) => event[flag] && ![...held].some(code => code.startsWith(prefix)));
        if (missing) { candidate = undefined; report("release-first"); return; }
        candidate = { code: event.code, modifiers: [...held].filter(code => code !== event.code).sort() };
      },
      keyup(event) {
        if (!active) return;
        event.preventDefault(); event.stopPropagation();
        held.delete(event.code);
        if (candidate?.code !== event.code) return;
        const selected = candidate;
        cancel(); report(commit(selected) === false ? "disconnected" : "saved");
      }
    };
  }
  window.CodexShortcutRecorder = Object.freeze({ create });
})();
