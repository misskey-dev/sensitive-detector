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

## ONNX Conversion

`nsfw_model.onnx` is converted from the TensorFlow.js model files in this directory.
The conversion was verified on an M2 MacBook Air (macOS, ARM64).

### Prerequisites

- Docker

### Steps

Run the following command from the `nsfw-model/` directory:

```sh
docker run --rm -v $(pwd):/model python:3.11-slim bash -c "pip install tensorflow==2.15.1 tensorflowjs==4.22.0 tf2onnx onnx==1.16.2 setuptools==75.8.2 && python3 -c \"
import types, sys
# Mock tensorflow_decision_forests to avoid inference.so error
mod = types.ModuleType('tensorflow_decision_forests')
mod.keras = types.ModuleType('tensorflow_decision_forests.keras')
sys.modules['tensorflow_decision_forests'] = mod
sys.modules['tensorflow_decision_forests.keras'] = mod.keras

import tensorflowjs as tfjs
import tensorflow as tf
import tf2onnx
model = tfjs.converters.load_keras_model('/model/model.json')
input_spec = (tf.TensorSpec((1, 299, 299, 3), tf.float32, name='input'),)
tf2onnx.convert.from_keras(model, input_signature=input_spec, output_path='/model/nsfw_model.onnx')
print('ONNX model saved successfully')
\""
```

This produces `nsfw_model.onnx` with input shape `[1, 299, 299, 3]` (float32) and
output shape `[1, 5]` (softmax probabilities for Drawing, Hentai, Neutral, Porn, Sexy).

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
