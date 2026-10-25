// Explicit SDR rendition: do not expand an SDR-base gain map into HDR first.
// Core Image applies the system tone mapper only when the source needs it.
import Foundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
guard CommandLine.arguments.count == 4,
      let edge = Double(CommandLine.arguments[3]), edge >= 0 else { fail("Invalid arguments") }
guard #available(macOS 14, *) else { fail("Requires macOS 14 or later") }
let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
guard let image = CIImage(contentsOf: input, options: [
    .toneMapHDRtoSDR: true, .expandToHDR: false, .applyOrientationProperty: true
]) else { fail("Cannot decode SDR rendition") }
let original = image.extent
guard original.width.isFinite, original.height.isFinite,
      original.width > 0, original.height > 0,
      original.width * original.height <= 110_000_000 else { fail("Invalid image extent") }
let ratio = edge > 0 ? min(1, edge / max(original.width, original.height)) : 1
let width = max(1, (original.width * ratio).rounded())
let height = max(1, (original.height * ratio).rounded())
let scaled = image.transformed(by: CGAffineTransform(translationX: -original.minX, y: -original.minY))
    .transformed(by: CGAffineTransform(scaleX: width / original.width, y: height / original.height))
guard let space = CGColorSpace(name: CGColorSpace.sRGB),
      let working = CGColorSpace(name: CGColorSpace.extendedLinearSRGB) else { fail("Missing color spaces") }
// Software context also works in a headless worker. Each invocation exits and frees its context.
let context = CIContext(options: [.useSoftwareRenderer: true, .workingColorSpace: working])
guard let cg = context.createCGImage(scaled, from: CGRect(x: 0, y: 0, width: width, height: height),
                                    format: .RGBA8, colorSpace: space),
      let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil)
else { fail("Cannot render SDR image") }
CGImageDestinationAddImage(destination, cg, nil)
guard CGImageDestinationFinalize(destination) else { fail("Cannot write SDR image") }
let report = ["width": Int(width), "height": Int(height),
              "sourceWidth": Int(original.width), "sourceHeight": Int(original.height)]
guard let data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]),
      let json = String(data: data, encoding: .utf8) else { fail("Cannot report dimensions") }
print(json)
