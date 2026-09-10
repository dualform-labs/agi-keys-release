import ApplicationServices
import AppKit
import Foundation

private struct Request: Decodable {
    let requestId: String
    let action: String
    let pid: Int32?
    let bundleId: String?
    let token: String?
    let revision: UInt64?
}

private struct Response: Encodable {
    let requestId: String
    let ok: Bool
    let token: String?
    let revision: UInt64?
    let error: String?
}

private struct WindowRecord {
    let pid: pid_t
    let bundleId: String
    let element: AXUIElement
    let revision: UInt64
}

private var windows: [String: WindowRecord] = [:]
private var nextRevision: UInt64 = 1
private let encoder = JSONEncoder()
private let stdout = FileHandle.standardOutput

private func reply(_ response: Response) {
    guard let data = try? encoder.encode(response) else { return }
    stdout.write(data)
    stdout.write(Data([0x0a]))
}

private func failure(_ requestId: String, _ code: String) {
    reply(Response(requestId: requestId, ok: false, token: nil, revision: nil, error: code))
}

private func exactApplication(pid: pid_t, bundleId: String) -> NSRunningApplication? {
    guard pid > 0,
          !bundleId.isEmpty,
          let app = NSRunningApplication(processIdentifier: pid),
          !app.isTerminated,
          app.bundleIdentifier == bundleId else { return nil }
    return app
}

private func copyElement(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
          let value,
          CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return unsafeBitCast(value, to: AXUIElement.self)
}

private func copyString(_ element: AXUIElement, _ attribute: String) -> String? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
    return value as? String
}

private func focusedCodexWindow(pid: pid_t, bundleId: String) -> AXUIElement? {
    guard exactApplication(pid: pid, bundleId: bundleId) != nil else { return nil }
    let system = AXUIElementCreateSystemWide()
    guard let focusedApplication = copyElement(system, kAXFocusedApplicationAttribute),
          applicationPid(focusedApplication) == pid,
          let focusedWindow = copyElement(focusedApplication, kAXFocusedWindowAttribute),
          applicationPid(focusedWindow) == pid,
          copyString(focusedWindow, kAXRoleAttribute) == kAXWindowRole else { return nil }
    return focusedWindow
}

private func applicationPid(_ element: AXUIElement) -> pid_t? {
    var pid: pid_t = 0
    return AXUIElementGetPid(element, &pid) == .success && pid > 0 ? pid : nil
}

private func validate(_ request: Request) -> (pid_t, String)? {
    guard let rawPid = request.pid,
          rawPid > 0,
          let bundleId = request.bundleId,
          !bundleId.isEmpty else { return nil }
    return (pid_t(rawPid), bundleId)
}

private func handleCapture(_ request: Request) {
    guard AXIsProcessTrusted() else { return failure(request.requestId, "E_WINDOW_FOCUS_PERMISSION") }
    guard let (pid, bundleId) = validate(request),
          let window = focusedCodexWindow(pid: pid, bundleId: bundleId) else {
        return failure(request.requestId, "E_WINDOW_FOCUS_CAPTURE_UNAVAILABLE")
    }
    let token = UUID().uuidString.lowercased()
    let revision = nextRevision
    nextRevision &+= 1
    windows[token] = WindowRecord(pid: pid, bundleId: bundleId, element: window, revision: revision)
    reply(Response(requestId: request.requestId, ok: true, token: token, revision: revision, error: nil))
}

private func exactRecord(_ request: Request) -> WindowRecord? {
    guard let token = request.token,
          let revision = request.revision,
          let record = windows[token],
          record.revision == revision,
          let (pid, bundleId) = validate(request),
          record.pid == pid,
          record.bundleId == bundleId,
          exactApplication(pid: pid, bundleId: bundleId) != nil,
          applicationPid(record.element) == pid,
          copyString(record.element, kAXRoleAttribute) == kAXWindowRole else { return nil }
    return record
}

private func handleVerifyCapture(_ request: Request) {
    guard AXIsProcessTrusted() else { return failure(request.requestId, "E_WINDOW_FOCUS_PERMISSION") }
    guard let record = exactRecord(request),
          let focused = focusedCodexWindow(pid: record.pid, bundleId: record.bundleId),
          CFEqual(record.element, focused) else {
        return failure(request.requestId, "E_WINDOW_FOCUS_CAPTURE_CHANGED")
    }
    reply(Response(requestId: request.requestId, ok: true, token: request.token, revision: record.revision, error: nil))
}

private func handleFocus(_ request: Request) {
    guard AXIsProcessTrusted() else { return failure(request.requestId, "E_WINDOW_FOCUS_PERMISSION") }
    guard let record = exactRecord(request) else {
        return failure(request.requestId, "E_WINDOW_FOCUS_REGISTRATION_STALE")
    }
    let application = AXUIElementCreateApplication(record.pid)
    guard AXUIElementPerformAction(record.element, kAXRaiseAction as CFString) == .success,
          AXUIElementSetAttributeValue(application, kAXFrontmostAttribute as CFString, kCFBooleanTrue) == .success,
          let focused = focusedCodexWindow(pid: record.pid, bundleId: record.bundleId),
          CFEqual(record.element, focused) else {
        return failure(request.requestId, "E_WINDOW_FOCUS_FAILED")
    }
    reply(Response(requestId: request.requestId, ok: true, token: request.token, revision: record.revision, error: nil))
}

private func handle(_ request: Request) {
    guard !request.requestId.isEmpty else { return }
    switch request.action {
    case "capture": handleCapture(request)
    case "verify-capture": handleVerifyCapture(request)
    case "focus": handleFocus(request)
    case "reset":
        windows.removeAll()
        nextRevision &+= 1
        reply(Response(requestId: request.requestId, ok: true, token: nil, revision: nil, error: nil))
    default: failure(request.requestId, "E_WINDOW_FOCUS_REQUEST_INVALID")
    }
}

while let line = readLine() {
    guard let data = line.data(using: .utf8),
          data.count <= 16_384,
          let request = try? JSONDecoder().decode(Request.self, from: data) else { continue }
    handle(request)
}
