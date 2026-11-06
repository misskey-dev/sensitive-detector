# E2E image fixtures

These fixed AI-generated images exercise real ONNX inference. They are regression
examples, not a dataset for measuring model accuracy or a definition of sensitive
content. Both were generated for this project with the built-in OpenAI
`image_gen` tool on 2026-11-06. No photograph or other reference image was supplied
for either generation.

| File                          | Expected top class | Subject                                                   | Prompt                                                  |
| ----------------------------- | ------------------ | --------------------------------------------------------- | ------------------------------------------------------- |
| `neutral-synthetic-cat.png`   | `Neutral`          | Photograph-style rendering of a fictional adult tabby cat | [Generation prompt](neutral-synthetic-cat.prompt.txt)   |
| `sexy-synthetic-swimwear.png` | `Sexy`             | 3D illustration of a fictional adult in opaque swimwear   | [Generation prompt](sexy-synthetic-swimwear.prompt.txt) |

## Provenance and reuse

The cat prompt requests a generic fictional animal without a specific real pet,
reference photograph, branded mascot or existing fictional character. The swimwear
prompt requests an entirely fictional adult, a visibly synthetic 3D style, a
neutral pose, opaque clothing and no real-person or existing-character references.
The committed prompts record the inputs used to generate the selected images.
Neither test fixture is a third-party photograph.

Both project-generated fixtures are included under the repository's
[MIT license](../../../../LICENSE), to the extent the contributors hold rights in
them. This does not assert exclusive copyright in AI-generated output.

## Normalization and expectations

Both selected images were resized to 299×299 (whole image, no crop) using FFmpeg's
Lanczos filter and converted to an 8-bit RGB PNG. Metadata is not copied. To
reproduce normalization from a source image:

```sh
ffmpeg -i original.png -vf scale=299:299:flags=lanczos -pix_fmt rgb24 -frames:v 1 fixture.png
```

CI reads the committed PNGs and never downloads, generates or converts images.
Both were verified against the real bundled ONNX model: the cat's winning class
was `Neutral` (approximately 0.999855 at selection time), and the swimwear
illustration's winning class was `Sexy` (approximately 0.967). Only the winning
class and probability validity are asserted, not exact floats.
