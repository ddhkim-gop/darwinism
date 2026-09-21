// On-device text recognition. Nothing is uploaded: Vision runs locally, which
// is the whole reason this is a compiled helper rather than an API call.
import Foundation
import Vision
import AppKit

guard CommandLine.arguments.count > 1 else {
    FileHandle.standardError.write("usage: ocr_vision IMAGE…\n".data(using: .utf8)!)
    exit(2)
}

for path in CommandLine.arguments.dropFirst() {
    guard let image = NSImage(contentsOfFile: path),
          let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        FileHandle.standardError.write("cannot read \(path)\n".data(using: .utf8)!)
        continue
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    // Off on purpose: a score bug and a jersey are not prose, and correction
    // turns "DAL" into a dictionary word.
    request.usesLanguageCorrection = false
    try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])

    print("## \(path)")
    for observation in request.results ?? [] {
        guard let best = observation.topCandidates(1).first else { continue }
        // Position matters as much as the text: a score bug is read by pairing
        // each number with the team code to its left, which needs geometry.
        // Vision's origin is bottom-left, normalised 0-1.
        let b = observation.boundingBox
        print("\(best.string)\t\(String(format: "%.2f", best.confidence))" +
              "\t\(String(format: "%.4f %.4f %.4f %.4f", b.minX, b.minY, b.width, b.height))")
    }
}
