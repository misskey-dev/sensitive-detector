# E2E image fixtures

These fixed images exercise real ONNX inference. They are regression examples,
not a dataset for measuring model accuracy or a definition of sensitive content.
The `Sexy` fixture is an AI-generated 3D illustration of a fictional adult in
opaque swimwear. It is not a photograph. No reference images were supplied.

| File                          | Expected top class | Source                                                                                | License                           |
| ----------------------------- | ------------------ | ------------------------------------------------------------------------------------- | --------------------------------- |
| `neutral-cat.png`             | `Neutral`          | Alexandra, [Cat-1044750.jpg](https://commons.wikimedia.org/wiki/File:Cat-1044750.jpg) | CC0-1.0                           |
| `sexy-synthetic-swimwear.png` | `Sexy`             | Generated for this project with OpenAI `image_gen`, 2026-11-06                        | Repository MIT license; see below |

## Cat photograph

The source file page explicitly dedicates this photograph to the public domain
under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), allowing copying,
modification and redistribution without an attribution requirement. The original
Pixabay publication was also reviewed on Commons in July 2017. Source and licensing
were checked on 2026-11-06. Its CC0 license is independent of the code license.

Original file:
https://upload.wikimedia.org/wikipedia/commons/0/01/Cat-1044750.jpg

## Generated swimwear illustration

The built-in OpenAI `image_gen` tool generated this asset from the committed
[prompt](sexy-synthetic-swimwear.prompt.txt) on 2026-11-06. The prompt requests an
entirely fictional adult, a visibly synthetic 3D style, a neutral pose, opaque
swimwear, and no real-person or existing-character references. No photograph or
other reference image was used as an input. The former real-person photograph is
not used by the test.

This project-generated fixture is included under the repository's
[MIT license](../../../../LICENSE), to the extent the contributors hold rights in
it. This does not assert exclusive copyright in AI-generated output. The cat's
third-party CC0 license should not be applied to this generated fixture.

## Normalization and expectations

Both selected images were resized to 299×299 (whole image, no crop) using FFmpeg's
Lanczos filter and converted to an 8-bit RGB PNG. Metadata is not copied. To
reproduce normalization from a source image:

```sh
ffmpeg -i original.png -vf scale=299:299:flags=lanczos -pix_fmt rgb24 -frames:v 1 fixture.png
```

CI reads the committed PNGs and never downloads, generates or converts images.
The generated illustration was verified against the real bundled ONNX model:
`Sexy` was the highest-probability class (approximately 0.967 at selection time).
Only the winning class and probability validity are asserted, not exact floats.
The normal cat's expected winning class remains `Neutral`.
