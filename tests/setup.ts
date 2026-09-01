class DOMMatrixPolyfill {}
class ImageDataPolyfill {}
class Path2DPolyfill {}

Object.assign(globalThis, {
  DOMMatrix: DOMMatrixPolyfill,
  ImageData: ImageDataPolyfill,
  Path2D: Path2DPolyfill,
});
