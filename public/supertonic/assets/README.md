# Supertonic Asset Notes

The app now loads Supertonic 3 web assets directly from Hugging Face at runtime:

```txt
https://huggingface.co/Supertone/supertonic-3/resolve/main/
```

The large ONNX files should not be committed to this repository. GitHub rejects normal Git blobs over 100 MB, and the Supertonic `vector_estimator.onnx` and `vocoder.onnx` files exceed that limit.

If you intentionally want to serve assets locally instead, override these settings in `src/config/settings.ts` and provide this layout:

```txt
public/supertonic/assets/
  onnx/
    duration_predictor.onnx
    text_encoder.onnx
    vector_estimator.onnx
    vocoder.onnx
    tts.json
    unicode_indexer.json
  voice_styles/
    M1.json
    M2.json
    M3.json
    M4.json
    M5.json
    F1.json
    F2.json
    F3.json
    F4.json
    F5.json
```

The browser only downloads static model/config/style assets. Audio, transcript text, and generated speech are not posted to an application server by this app.

The assets are distributed by `Supertone/supertonic-3` on Hugging Face. See that model repository for the current license.
