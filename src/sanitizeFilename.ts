/**
 * Replaces characters that are illegal in Windows file and directory names with
 * "-" so pages whose titles contain them still save on every OS.
 *
 * The original code only replaced "/", which is enough on macOS/Linux. Windows
 * additionally forbids < > : " \ | ? * and control characters, so (for example)
 * a page named `Camshaft Position "A" Actuator Circuit` failed to save on Windows.
 */
export default function sanitizeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[<>:"\/\\|?*\u0000-\u001f]/g, "-");
}
