// Small video tool on AVFoundation, for editing the Quest 3 recordings (no ffmpeg needed).
// Build: swiftc -O tools/video/vtool.swift -o /tmp/vtool   (outputs: keep raw recordings out of git)
//   vtool probe <in>                                              duration, tracks, size, fps
//   vtool sheet <in> <out.jpg> <start> <end> <count> [cols]       contact sheet with timestamps
//   vtool motion <in> <start> <end> <step>                        camera motion per step (pick calm takes)
//   vtool cut <in> <out.mp4> <ranges "s-e,s-e"> [preset]          join ranges, Apple preset (large files)
//   vtool encode <in> <out.mp4> <ranges> <w> <h> <kbps>           join ranges, H.264 + AAC at a set bitrate
//   vtool montage <in> <out.mp4> <ranges> <fade> <w> <h> <kbps>   like encode, with cross-fades (video + audio)
//   vtool gif <in> <out.gif> <width> <fps> [start] [end]          looping GIF (for the README)
//   vtool frame <in> <out.jpg> <sec>                              poster image
import AVFoundation
import AppKit
import CoreImage

func fail(_ s: String) -> Never { FileHandle.standardError.write((s + "\n").data(using: .utf8)!); exit(1) }

let args = CommandLine.arguments
guard args.count >= 3 else { fail("usage: vtool probe|sheet|motion|cut|encode|montage|gif|frame ...") }
let asset = AVURLAsset(url: URL(fileURLWithPath: args[2]))

func load<T>(_ f: @escaping () async throws -> T) -> T {
  var out: T?
  var err: Error?
  let sem = DispatchSemaphore(value: 0)
  Task { do { out = try await f() } catch { err = error }; sem.signal() }
  sem.wait()
  if let e = err { fail("\(e)") }
  return out!
}

switch args[1] {
case "probe":
  let dur = load { try await asset.load(.duration) }
  let tracks = load { try await asset.load(.tracks) }
  print(String(format: "duration %.1f s", dur.seconds))
  for t in tracks {
    let size = load { try await t.load(.naturalSize) }
    let fps = load { try await t.load(.nominalFrameRate) }
    let tf = load { try await t.load(.preferredTransform) }
    print("track \(t.mediaType.rawValue) size \(Int(size.width))x\(Int(size.height)) fps \(fps) transform \(tf.a),\(tf.b),\(tf.c),\(tf.d)")
  }

case "sheet":
  let out = args[3], start = Double(args[4])!, end = Double(args[5])!, count = Int(args[6])!
  let cols = args.count > 7 ? Int(args[7])! : 4
  let gen = AVAssetImageGenerator(asset: asset)
  gen.appliesPreferredTrackTransform = true
  gen.maximumSize = CGSize(width: 480, height: 480)
  gen.requestedTimeToleranceBefore = CMTime(seconds: 0.5, preferredTimescale: 600)
  gen.requestedTimeToleranceAfter = CMTime(seconds: 0.5, preferredTimescale: 600)
  var images: [(Double, CGImage)] = []
  for i in 0..<count {
    let t = count == 1 ? start : start + (end - start) * Double(i) / Double(count - 1)
    if let img = try? gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil) { images.append((t, img)) }
  }
  guard let first = images.first?.1 else { fail("no frames") }
  let w = first.width, h = first.height, rows = (images.count + cols - 1) / cols
  let ctx = CGContext(data: nil, width: w * cols, height: h * rows, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.setFillColor(CGColor(gray: 0, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: w * cols, height: h * rows))
  NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
  for (i, (t, img)) in images.enumerated() {
    let x = (i % cols) * w, y = (rows - 1 - i / cols) * h
    ctx.draw(img, in: CGRect(x: x, y: y, width: w, height: h))
    let label = String(format: "%d:%04.1f", Int(t) / 60, t.truncatingRemainder(dividingBy: 60)) as NSString
    let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.boldSystemFont(ofSize: 22), .foregroundColor: NSColor.yellow, .backgroundColor: NSColor.black]
    label.draw(at: CGPoint(x: x + 6, y: y + 6), withAttributes: attrs)
  }
  let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
  try! rep.representation(using: .jpeg, properties: [.compressionFactor: 0.7])!.write(to: URL(fileURLWithPath: out))
  print("wrote \(out) (\(images.count) frames)")

case "cut":
  // cut <in> <out.mp4> <ranges "s-e,s-e,..."> [preset]: joins the ranges, keeps video and audio
  let out = URL(fileURLWithPath: args[3])
  let ranges = args[4].split(separator: ",").map { r -> CMTimeRange in
    let se = r.split(separator: "-").map { Double($0)! }
    return CMTimeRange(start: CMTime(seconds: se[0], preferredTimescale: 600), end: CMTime(seconds: se[1], preferredTimescale: 600))
  }
  let preset = args.count > 5 ? args[5] : AVAssetExportPreset1280x720
  let comp = AVMutableComposition()
  for type in [AVMediaType.video, .audio] {
    guard let src = load({ try await asset.loadTracks(withMediaType: type) }).first else { continue }
    let dst = comp.addMutableTrack(withMediaType: type, preferredTrackID: kCMPersistentTrackID_Invalid)!
    var at = CMTime.zero
    for r in ranges { try! dst.insertTimeRange(r, of: src, at: at); at = at + r.duration }
    if type == .video { dst.preferredTransform = load { try await src.load(.preferredTransform) } }
  }
  try? FileManager.default.removeItem(at: out)
  let ex = AVAssetExportSession(asset: comp, presetName: preset)!
  ex.outputURL = out
  ex.outputFileType = .mp4
  ex.shouldOptimizeForNetworkUse = true
  let sem = DispatchSemaphore(value: 0)
  ex.exportAsynchronously { sem.signal() }
  sem.wait()
  if ex.status != .completed { fail("export failed: \(String(describing: ex.error))") }
  let bytes = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int) ?? 0
  print(String(format: "wrote %@ (%.1f MB, %.1f s)", out.lastPathComponent, Double(bytes) / 1e6, comp.duration.seconds))

case "encode":
  // encode <in> <out.mp4> <ranges> <width> <height> <kbps>: like cut, with explicit H.264 bitrate + AAC
  let out = URL(fileURLWithPath: args[3])
  let ranges = args[4].split(separator: ",").map { r -> CMTimeRange in
    let se = r.split(separator: "-").map { Double($0)! }
    return CMTimeRange(start: CMTime(seconds: se[0], preferredTimescale: 600), end: CMTime(seconds: se[1], preferredTimescale: 600))
  }
  let w = Int(args[5])!, h = Int(args[6])!, kbps = Int(args[7])!
  let comp = AVMutableComposition()
  var hasAudio = false
  for type in [AVMediaType.video, .audio] {
    guard let src = load({ try await asset.loadTracks(withMediaType: type) }).first else { continue }
    let dst = comp.addMutableTrack(withMediaType: type, preferredTrackID: kCMPersistentTrackID_Invalid)!
    var at = CMTime.zero
    for r in ranges { try! dst.insertTimeRange(r, of: src, at: at); at = at + r.duration }
    if type == .audio { hasAudio = true }
  }
  let reader = try! AVAssetReader(asset: comp)
  let vTrack = comp.tracks(withMediaType: .video)[0]
  let vOut = AVAssetReaderTrackOutput(track: vTrack, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
  reader.add(vOut)
  var aOut: AVAssetReaderTrackOutput?
  if hasAudio {
    let o = AVAssetReaderTrackOutput(track: comp.tracks(withMediaType: .audio)[0], outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM])
    reader.add(o); aOut = o
  }
  try? FileManager.default.removeItem(at: out)
  let writer = try! AVAssetWriter(outputURL: out, fileType: .mp4)
  writer.shouldOptimizeForNetworkUse = true
  let vIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: w, AVVideoHeightKey: h,
    AVVideoScalingModeKey: AVVideoScalingModeResizeAspect,
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: kbps * 1000, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel, AVVideoMaxKeyFrameIntervalKey: 60]])
  vIn.expectsMediaDataInRealTime = false
  writer.add(vIn)
  var aIn: AVAssetWriterInput?
  if hasAudio {
    let i = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 128000])
    writer.add(i); aIn = i
  }
  reader.startReading(); writer.startWriting(); writer.startSession(atSourceTime: .zero)
  let group = DispatchGroup()
  func pump(_ input: AVAssetWriterInput, _ output: AVAssetReaderTrackOutput, _ q: String) {
    group.enter()
    input.requestMediaDataWhenReady(on: DispatchQueue(label: q)) {
      while input.isReadyForMoreMediaData {
        if let b = output.copyNextSampleBuffer() { input.append(b) } else { input.markAsFinished(); group.leave(); return }
      }
    }
  }
  pump(vIn, vOut, "v")
  if let i = aIn, let o = aOut { pump(i, o, "a") }
  group.wait()
  let sem = DispatchSemaphore(value: 0)
  writer.finishWriting { sem.signal() }
  sem.wait()
  if writer.status != .completed { fail("encode failed: \(String(describing: writer.error))") }
  let bytes = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int) ?? 0
  print(String(format: "wrote %@ (%.1f MB, %.1f s)", out.lastPathComponent, Double(bytes) / 1e6, comp.duration.seconds))

case "motion":
  // motion <in> <start> <end> <step>: camera motion per step = mean abs difference of tiny grey frames
  let start = Double(args[3])!, end = Double(args[4])!, step = Double(args[5])!
  let reader = try! AVAssetReader(asset: asset)
  let vt = load { try await asset.loadTracks(withMediaType: .video) }.first!
  let out = AVAssetReaderTrackOutput(track: vt, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange])
  out.alwaysCopiesSampleData = false
  reader.timeRange = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: 600), end: CMTime(seconds: end, preferredTimescale: 600))
  reader.add(out)
  reader.startReading()
  var prev: [Float]? = nil, nextT = start
  var line = ""
  while let sb = out.copyNextSampleBuffer() {
    let t = CMSampleBufferGetPresentationTimeStamp(sb).seconds
    if t < nextT { continue }
    nextT += step
    guard let pb = CMSampleBufferGetImageBuffer(sb) else { continue }
    CVPixelBufferLockBaseAddress(pb, .readOnly)
    let w = CVPixelBufferGetWidthOfPlane(pb, 0), h = CVPixelBufferGetHeightOfPlane(pb, 0), bpr = CVPixelBufferGetBytesPerRowOfPlane(pb, 0)
    let base = CVPixelBufferGetBaseAddressOfPlane(pb, 0)!.assumingMemoryBound(to: UInt8.self)
    var g = [Float](repeating: 0, count: 64 * 36)
    for y in 0..<36 { for x in 0..<64 { g[y * 64 + x] = Float(base[(y * h / 36) * bpr + (x * w / 64)]) } }
    CVPixelBufferUnlockBaseAddress(pb, .readOnly)
    if let p = prev {
      var d: Float = 0
      for i in 0..<g.count { d += abs(g[i] - p[i]) }
      line += String(format: "%.1f:%.0f ", t, d / Float(g.count))
    }
    prev = g
  }
  print(line)

case "montage":
  // montage <in> <out.mp4> <ranges> <fadeSec> <width> <height> <kbps>: ranges joined with cross-fades
  // (video dissolve and audio cross-fade), H.264 + AAC at an explicit bitrate.
  let out = URL(fileURLWithPath: args[3])
  let ranges = args[4].split(separator: ",").map { r -> CMTimeRange in
    let se = r.split(separator: "-").map { Double($0)! }
    return CMTimeRange(start: CMTime(seconds: se[0], preferredTimescale: 600), end: CMTime(seconds: se[1], preferredTimescale: 600))
  }
  let fade = CMTime(seconds: Double(args[5])!, preferredTimescale: 600)
  let w = Int(args[6])!, h = Int(args[7])!, kbps = Int(args[8])!
  let srcV = load { try await asset.loadTracks(withMediaType: .video) }.first!
  let srcA = load { try await asset.loadTracks(withMediaType: .audio) }.first
  let natural = load { try await srcV.load(.naturalSize) }
  let comp = AVMutableComposition()
  let lanes = min(2, ranges.count)
  let vT = (0..<lanes).map { _ in comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)! }
  let aT = srcA == nil ? [] : (0..<lanes).map { _ in comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)! }
  var segs: [(start: CMTime, end: CMTime, lane: Int)] = []
  var cursor = CMTime.zero
  for (i, r) in ranges.enumerated() {
    let lane = i % lanes
    try! vT[lane].insertTimeRange(r, of: srcV, at: cursor)
    if let a = srcA { try! aT[lane].insertTimeRange(r, of: a, at: cursor) }
    segs.append((cursor, cursor + r.duration, lane))
    cursor = cursor + r.duration - (i < ranges.count - 1 ? fade : .zero)
  }
  let total = segs.last!.end
  let vc = AVMutableVideoComposition()
  vc.renderSize = natural
  vc.frameDuration = CMTime(value: 1, timescale: 60)
  var instructions: [AVMutableVideoCompositionInstruction] = []
  let mix = AVMutableAudioMix()
  var params = aT.map { AVMutableAudioMixInputParameters(track: $0) }
  for (i, s) in segs.enumerated() {
    let inStart = i > 0 ? s.start + fade : s.start
    let outStart = i < segs.count - 1 ? s.end - fade : s.end
    let solo = AVMutableVideoCompositionInstruction()
    solo.timeRange = CMTimeRange(start: inStart, end: outStart)
    solo.layerInstructions = [AVMutableVideoCompositionLayerInstruction(assetTrack: vT[s.lane])]
    instructions.append(solo)
    if i < segs.count - 1 {
      let next = segs[i + 1]
      let tr = CMTimeRange(start: outStart, end: s.end)
      let x = AVMutableVideoCompositionInstruction()
      x.timeRange = tr
      let outgoing = AVMutableVideoCompositionLayerInstruction(assetTrack: vT[s.lane])
      outgoing.setOpacityRamp(fromStartOpacity: 1, toEndOpacity: 0, timeRange: tr)
      x.layerInstructions = [outgoing, AVMutableVideoCompositionLayerInstruction(assetTrack: vT[next.lane])]
      instructions.append(x)
      if !params.isEmpty {
        params[s.lane].setVolumeRamp(fromStartVolume: 1, toEndVolume: 0, timeRange: tr)
        params[next.lane].setVolumeRamp(fromStartVolume: 0, toEndVolume: 1, timeRange: tr)
      }
    }
  }
  vc.instructions = instructions
  mix.inputParameters = params

  let reader = try! AVAssetReader(asset: comp)
  reader.timeRange = CMTimeRange(start: .zero, end: total)
  let vOut = AVAssetReaderVideoCompositionOutput(videoTracks: vT, videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
  vOut.videoComposition = vc
  reader.add(vOut)
  var aOut: AVAssetReaderAudioMixOutput?
  if !aT.isEmpty {
    let o = AVAssetReaderAudioMixOutput(audioTracks: aT, audioSettings: [AVFormatIDKey: kAudioFormatLinearPCM])
    o.audioMix = mix
    reader.add(o); aOut = o
  }
  try? FileManager.default.removeItem(at: out)
  let writer = try! AVAssetWriter(outputURL: out, fileType: .mp4)
  writer.shouldOptimizeForNetworkUse = true
  let vIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: w, AVVideoHeightKey: h,
    AVVideoScalingModeKey: AVVideoScalingModeResizeAspect,
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: kbps * 1000, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel, AVVideoMaxKeyFrameIntervalKey: 60]])
  writer.add(vIn)
  var aIn: AVAssetWriterInput?
  if aOut != nil {
    let i = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 128000])
    writer.add(i); aIn = i
  }
  reader.startReading(); writer.startWriting(); writer.startSession(atSourceTime: .zero)
  let group = DispatchGroup()
  func pump(_ input: AVAssetWriterInput, _ next: @escaping () -> CMSampleBuffer?, _ q: String) {
    group.enter()
    input.requestMediaDataWhenReady(on: DispatchQueue(label: q)) {
      while input.isReadyForMoreMediaData {
        if let b = next() { input.append(b) } else { input.markAsFinished(); group.leave(); return }
      }
    }
  }
  pump(vIn, { vOut.copyNextSampleBuffer() }, "v")
  if let i = aIn, let o = aOut { pump(i, { o.copyNextSampleBuffer() }, "a") }
  group.wait()
  let sem2 = DispatchSemaphore(value: 0)
  writer.finishWriting { sem2.signal() }
  sem2.wait()
  if writer.status != .completed || reader.status == .failed { fail("montage failed: \(String(describing: writer.error ?? reader.error))") }
  let bytes = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int) ?? 0
  print(String(format: "wrote %@ (%.1f MB, %.1f s)", out.lastPathComponent, Double(bytes) / 1e6, total.seconds))

case "gif":
  // gif <in> <out.gif> <width> <fps> [start] [end]: looping animated GIF for places that do not play video
  let width = Double(args[4])!, fps = Double(args[5])!
  let dur = load { try await asset.load(.duration) }.seconds
  let start = args.count > 6 ? Double(args[6])! : 0, end = args.count > 7 ? Double(args[7])! : dur
  let gen = AVAssetImageGenerator(asset: asset)
  gen.appliesPreferredTrackTransform = true
  gen.maximumSize = CGSize(width: width, height: width)
  gen.requestedTimeToleranceBefore = .zero
  gen.requestedTimeToleranceAfter = .zero
  let n = Int((end - start) * fps)
  let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[3]) as CFURL, "com.compuserve.gif" as CFString, n, nil)!
  CGImageDestinationSetProperties(dest, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
  let frameProps = [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFUnclampedDelayTime: 1.0 / fps, kCGImagePropertyGIFDelayTime: 1.0 / fps]] as CFDictionary
  for i in 0..<n {
    if let img = try? gen.copyCGImage(at: CMTime(seconds: start + Double(i) / fps, preferredTimescale: 600), actualTime: nil) {
      CGImageDestinationAddImage(dest, img, frameProps)
    }
  }
  if !CGImageDestinationFinalize(dest) { fail("gif failed") }
  let bytes = (try? FileManager.default.attributesOfItem(atPath: args[3])[.size] as? Int) ?? 0
  print(String(format: "wrote %@ (%.1f MB, %d frames)", (args[3] as NSString).lastPathComponent, Double(bytes) / 1e6, n))

case "frame":
  // frame <in> <out.jpg> <sec>: one full-size still (poster image)
  let gen = AVAssetImageGenerator(asset: asset)
  gen.appliesPreferredTrackTransform = true
  gen.maximumSize = CGSize(width: 1280, height: 720)
  let img = try! gen.copyCGImage(at: CMTime(seconds: Double(args[4])!, preferredTimescale: 600), actualTime: nil)
  let rep = NSBitmapImageRep(cgImage: img)
  try! rep.representation(using: .jpeg, properties: [.compressionFactor: 0.8])!.write(to: URL(fileURLWithPath: args[3]))
  print("wrote \(args[3])")

default:
  fail("unknown command")
}
