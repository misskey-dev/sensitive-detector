# nsfw-model

This directory contains the InceptionV3-based NSFW detection model files.

## Origin

The model was originally trained by [Gant Laborde](https://github.com/GantMan) and
distributed as part of [nsfwjs](https://github.com/infinitered/nsfwjs) by Infinite Red, Inc.
The files were copied into this repository via [misskey-dev/misskey](https://github.com/misskey-dev/misskey),
which bundles them for its `AiService.detectSensitive` implementation.

| Layer | Repository | License |
|-------|-----------|---------|
| Original trained model | [GantMan/nsfw_model](https://github.com/GantMan/nsfw_model) | MIT |
| JS wrapper / model bundle | [infinitered/nsfwjs](https://github.com/infinitered/nsfwjs) | MIT |
| Intermediate source (copy path) | [misskey-dev/misskey](https://github.com/misskey-dev/misskey) | AGPL-3.0 |

The model files are distributed with the MIT license notices of GantMan/nsfw_model and
infinitered/nsfwjs (see below). Misskey is noted only as the intermediate source from which
these files were copied; the AGPL-3.0 of Misskey applies to Misskey's own code, not to
these model files.

The files correspond to the model bundle included in **nsfwjs v4.3.0**. The specific
Misskey commit from which they were copied was not recorded at the time of import.

> **Note:** GantMan/nsfw_model's LICENSE.md states that the project contains
> third-party copyrighted material under different licenses. See the
> [upstream LICENSE.md](https://github.com/GantMan/nsfw_model/blob/master/LICENSE.md)
> for details.

## License Notices

### GantMan/nsfw_model

MIT License

Copyright (c) 2020 The nsfw_model Developers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### infinitered/nsfwjs

MIT License

Copyright (c) 2019 Infinite Red, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
