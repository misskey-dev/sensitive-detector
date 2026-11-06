# E2E image fixtures

These fixed images exercise real ONNX inference. They are regression examples,
not a dataset for measuring model accuracy or a definition of sensitive content.
The `Sexy` fixture depicts an adult wearing a bikini; it contains no nudity.

| File              | Expected top class | Creator   | Source                                                                                                                                                 | License |
| ----------------- | ------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `neutral-cat.png` | `Neutral`          | Alexandra | [Cat-1044750.jpg](https://commons.wikimedia.org/wiki/File:Cat-1044750.jpg)                                                                             | CC0-1.0 |
| `sexy-bikini.png` | `Sexy`             | Keymeulen | [Young woman in bikini on the beach, Portugal 2010.jpg](https://commons.wikimedia.org/wiki/File:Young_woman_in_bikini_on_the_beach,_Portugal_2010.jpg) | CC0-1.0 |

Both source file pages explicitly dedicate the photographs to the public domain
under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), allowing copying,
modification and redistribution without an attribution requirement. The cat's
original Pixabay CC0 release was also reviewed on Commons in July 2017. Sources
and licensing were checked on 2026-11-06. These image licenses are independent of
the repository's code license.

Original files:

- https://upload.wikimedia.org/wikipedia/commons/0/01/Cat-1044750.jpg
- https://upload.wikimedia.org/wikipedia/commons/9/9c/Young_woman_in_bikini_on_the_beach%2C_Portugal_2010.jpg

Each original was resized to 299×299 (whole image, no crop) using FFmpeg's Lanczos
filter and converted to an 8-bit RGB PNG. Metadata is not copied. To reproduce:

```sh
ffmpeg -i original.jpg -vf scale=299:299:flags=lanczos -pix_fmt rgb24 -frames:v 1 fixture.png
```

CI reads the committed PNGs and never downloads or converts images. Expectations
are fixed from their content (`Neutral` for a cat, `Sexy` for the bikini photo);
only the winning class and probability validity are checked, not exact floats.
