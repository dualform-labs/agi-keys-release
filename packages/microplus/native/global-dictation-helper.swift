import ApplicationServices
import Darwin
import Dispatch

private let toggleMode = CommandLine.arguments.dropFirst().contains("--toggle-right-option")
private let rightCommand: CGKeyCode = toggleMode ? 61 : 54
private let leftCommand: CGKeyCode = toggleMode ? 58 : 55
private let state = CGEventSourceStateID.combinedSessionState
private let rightCommandDeviceFlag = CGEventFlags(rawValue: toggleMode ? 0x00000040 : 0x00000010)
private let modifierMask: CGEventFlags = toggleMode ? .maskAlternate : .maskCommand
private let eventSource = CGEventSource(stateID: state)

// Keep the posting process alive while the release traverses the event stream.
// This observes OS modifier state, not the receiving app's recording state.
private func awaitRightCommandRelease(isHeld: () -> Bool, pause: () -> Void) -> Bool {
    for _ in 0..<8 { pause() }
    for _ in 0..<50 {
        if !isHeld() { return true }
        pause()
    }
    return !isHeld()
}

if CommandLine.arguments == [CommandLine.arguments[0], "--test-release-wait"] {
    var ticks = 0
    precondition(awaitRightCommandRelease(isHeld: { ticks < 12 }, pause: { ticks += 1 }))
    precondition(ticks == 12)
    ticks = 0
    precondition(!awaitRightCommandRelease(isHeld: { true }, pause: { ticks += 1 }))
    precondition(ticks == 58)
    ticks = 0
    precondition(awaitRightCommandRelease(isHeld: { false }, pause: { ticks += 1 }))
    precondition(ticks == 8)
    FileHandle.standardOutput.write(Data("RELEASE_WAIT_TEST_OK\n".utf8))
    exit(0)
}

private func togglePulse(post: (Bool) -> Bool, pause: () -> Void) -> Bool {
    guard post(true) else { return false }
    pause()
    return post(false)
}

if CommandLine.arguments == [CommandLine.arguments[0], "--test-toggle-pair"] {
    var events: [Bool] = []
    var pauses = 0
    let post: (Bool) -> Bool = { events.append($0); return true }
    let pause: () -> Void = { pauses += 1 }
    precondition(togglePulse(post: post, pause: pause))
    precondition(togglePulse(post: post, pause: pause))
    precondition(events == [true, false, true, false] && pauses == 2)
    events = []
    precondition(!togglePulse(post: { events.append($0); return false }, pause: pause))
    precondition(events == [true])
    FileHandle.standardOutput.write(Data("TOGGLE_PAIR_TEST_OK\n".utf8))
    exit(0)
}

private func stampForDelivery(_ event: CGEvent, now: () -> UInt64 = { DispatchTime.now().uptimeNanoseconds }) {
    event.timestamp = now()
}

if CommandLine.arguments == [CommandLine.arguments[0], "--test-event-timestamps"] {
    let source = CGEventSource(stateID: .combinedSessionState)!
    let down = CGEvent(keyboardEventSource: source, virtualKey: 61, keyDown: true)!
    let up = CGEvent(keyboardEventSource: source, virtualKey: 61, keyDown: false)!
    stampForDelivery(down, now: { 1_000_000_000 })
    stampForDelivery(up, now: { 1_040_000_000 })
    precondition(up.timestamp - down.timestamp == 40_000_000)
    FileHandle.standardOutput.write(Data("EVENT_TIMESTAMPS_TEST_OK\n".utf8))
    exit(0)
}

private func postRightCommand(isDown: Bool, prepared: CGEvent? = nil) -> Bool {
    guard let source = eventSource,
          let event = prepared ?? CGEvent(keyboardEventSource: source, virtualKey: rightCommand, keyDown: isDown) else {
        return false
    }
    var flags = CGEventSource.flagsState(state)
    if isDown {
        flags.insert(modifierMask)
        flags.insert(rightCommandDeviceFlag)
    } else {
        flags.remove(rightCommandDeviceFlag)
        if CGEventSource.keyState(state, key: leftCommand) {
            flags.insert(modifierMask)
        } else {
            flags.remove(modifierMask)
        }
    }
    event.flags = flags
    event.type = .flagsChanged
    stampForDelivery(event)
    event.post(tap: .cghidEventTap)
    return true
}

// Allocate both events before posting either half of a toggle.
private func postTogglePulse() -> Bool {
    guard let source = eventSource,
          let down = CGEvent(keyboardEventSource: source, virtualKey: rightCommand, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: rightCommand, keyDown: false) else { return false }
    return togglePulse(post: { isDown in
        postRightCommand(isDown: isDown, prepared: isDown ? down : up)
    }, pause: { usleep(40_000) })
}

// Recorded DOM physical-key codes map to macOS virtual keys.
private let recordedKeys: [String: CGKeyCode] = [
 "KeyA":0,"KeyS":1,"KeyD":2,"KeyF":3,"KeyH":4,"KeyG":5,"KeyZ":6,"KeyX":7,"KeyC":8,"KeyV":9,"KeyB":11,"KeyQ":12,"KeyW":13,"KeyE":14,"KeyR":15,"KeyY":16,"KeyT":17,
 "Digit1":18,"Digit2":19,"Digit3":20,"Digit4":21,"Digit6":22,"Digit5":23,"Digit9":25,"Digit7":26,"Digit8":28,"Digit0":29,"KeyO":31,"KeyU":32,"KeyI":34,"KeyP":35,"Enter":36,"KeyL":37,"KeyJ":38,"KeyK":40,"KeyN":45,"KeyM":46,"Space":49,
 "MetaRight":54,"MetaLeft":55,"ShiftLeft":56,"AltLeft":58,"ControlLeft":59,"ShiftRight":60,"AltRight":61,"ControlRight":62,
 "F1":122,"F2":120,"F3":99,"F4":118,"F5":96,"F6":97,"F7":98,"F8":100,"F9":101,"F10":109,"F11":103,"F12":111]
private let recordedModifiers: [String: (CGEventFlags, UInt64)] = [
 "MetaLeft":(.maskCommand,0x08),"MetaRight":(.maskCommand,0x10),"AltLeft":(.maskAlternate,0x20),"AltRight":(.maskAlternate,0x40),
 "ControlLeft":(.maskControl,0x01),"ControlRight":(.maskControl,0x2000),"ShiftLeft":(.maskShift,0x02),"ShiftRight":(.maskShift,0x04)]
struct RecordedShortcut: Decodable { let code: String; let modifiers: [String] }
private func validRecorded(_ shortcut: RecordedShortcut) -> Bool {
    recordedKeys[shortcut.code] != nil && Set(shortcut.modifiers).count == shortcut.modifiers.count
      && shortcut.modifiers.allSatisfy { recordedModifiers[$0] != nil && $0 != shortcut.code }
}
if CommandLine.arguments == [CommandLine.arguments[0], "--test-recorded-shortcut"] {
    precondition(recordedKeys["AltRight"] == 61 && recordedKeys["MetaRight"] == 54)
    precondition(recordedModifiers["AltRight"]!.1 == 0x40)
    precondition(validRecorded(RecordedShortcut(code: "KeyD", modifiers: ["MetaRight"])))
    precondition(!validRecorded(RecordedShortcut(code: "AudioVolumeUp", modifiers: [])))
    precondition(!validRecorded(RecordedShortcut(code: "KeyD", modifiers: ["Bogus"])))
    FileHandle.standardOutput.write(Data("RECORDED_SHORTCUT_TEST_OK\n".utf8))
    exit(0)
}
if CommandLine.arguments.count > 1 && CommandLine.arguments[1] == "--shortcut" {
    guard CommandLine.arguments.count == 3,
          let shortcut = try? JSONDecoder().decode(RecordedShortcut.self, from: Data(CommandLine.arguments[2].utf8)), validRecorded(shortcut) else { exit(76) }
    guard CGPreflightPostEventAccess() else { exit(72) }
    let sequence = shortcut.modifiers + [shortcut.code]
    guard !sequence.contains(where: { CGEventSource.keyState(state, key: recordedKeys[$0]!) }) else { exit(73) }
    func pulse() -> Bool {
        guard let source = eventSource else { return false }
        let steps = sequence.map { ($0,true) } + sequence.reversed().map { ($0,false) }
        // Reserve every event before the first event is posted.
        let events = steps.map { CGEvent(keyboardEventSource: source, virtualKey: recordedKeys[$0.0]!, keyDown: $0.1) }
        guard events.allSatisfy({ $0 != nil }) else { return false }
        var flags = CGEventSource.flagsState(state)
        for (index, step) in steps.enumerated() {
            if index == sequence.count { usleep(40_000) }
            let event = events[index]!
            if let modifier = recordedModifiers[step.0] {
                let bit = CGEventFlags(rawValue: modifier.1)
                if step.1 { flags.insert(modifier.0); flags.insert(bit) }
                else {
                    flags.remove(bit)
                    if !recordedModifiers.values.contains(where: { $0.0 == modifier.0 && flags.contains(CGEventFlags(rawValue: $0.1)) }) { flags.remove(modifier.0) }
                }
                event.type = .flagsChanged
            }
            event.flags = flags
            stampForDelivery(event)
            event.post(tap: .cghidEventTap)
        }
        return true
    }
    signal(SIGTERM) { _ in close(STDIN_FILENO) }
    signal(SIGINT) { _ in close(STDIN_FILENO) }
    signal(SIGHUP) { _ in close(STDIN_FILENO) }
    guard pulse() else { exit(74) }
    usleep(80_000)
    FileHandle.standardOutput.write(Data("READY\n".utf8))
    var input: UInt8 = 0
    while read(STDIN_FILENO, &input, 1) > 0 {}
    guard pulse() else { exit(75) }
    usleep(80_000)
    exit(0)
}

guard CGPreflightPostEventAccess() else {
    FileHandle.standardError.write(Data("E_GLOBAL_DICTATION_PERMISSION\n".utf8))
    exit(72)
}

if CGEventSource.keyState(state, key: rightCommand) {
    FileHandle.standardError.write(Data("E_RIGHT_COMMAND_ALREADY_HELD\n".utf8))
    exit(73)
}

// Read-only probe used by release verification. It checks the exact helper's
// CGEvent permission and current right-Command state without posting an event.
if CommandLine.arguments == [CommandLine.arguments[0], "--preflight"] {
    FileHandle.standardOutput.write(Data("READY\n".utf8))
    exit(0)
}

guard (toggleMode
    ? postTogglePulse()
    : postRightCommand(isDown: true)) else {
    FileHandle.standardError.write(Data("E_RIGHT_COMMAND_DOWN_FAILED\n".utf8))
    exit(74)
}

signal(SIGTERM) { _ in close(STDIN_FILENO) }
signal(SIGINT) { _ in close(STDIN_FILENO) }
signal(SIGHUP) { _ in close(STDIN_FILENO) }

// Separate start and stop even when the physical key is released immediately.
if toggleMode {
    guard awaitRightCommandRelease(
        isHeld: { CGEventSource.flagsState(state).contains(rightCommandDeviceFlag) },
        pause: { usleep(10_000) }
    ) else {
        FileHandle.standardError.write(Data("E_RIGHT_COMMAND_UP_UNOBSERVED\n".utf8))
        exit(75)
    }
}
FileHandle.standardOutput.write(Data("READY\n".utf8))

var byte: UInt8 = 0
while read(STDIN_FILENO, &byte, 1) > 0 {}

guard (toggleMode
    ? postTogglePulse()
    : postRightCommand(isDown: false)) else {
    FileHandle.standardError.write(Data("E_RIGHT_COMMAND_UP_FAILED\n".utf8))
    exit(75)
}

guard awaitRightCommandRelease(
    isHeld: { CGEventSource.flagsState(state).contains(rightCommandDeviceFlag) },
    pause: { usleep(10_000) }
) else {
    FileHandle.standardError.write(Data("E_RIGHT_COMMAND_UP_UNOBSERVED\n".utf8))
    exit(75)
}
