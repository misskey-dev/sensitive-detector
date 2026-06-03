import type { PredictionType } from 'nsfwjs/core';

// nsfwjs の予測値型をそのまま re-export する（className は Drawing/Hentai/Neutral/Porn/Sexy の union）。
export type { PredictionType };

/**
 * 失敗の分類コード。HTTP ステータスへのマッピングは server 側 `error-mapping` が持つ。
 */
export type DetectErrorCode =
  | 'AUTHENTICATION_REQUIRED' // 401
  | 'INVALID_REQUEST' // 400（空ボディ等）
  | 'UNSUPPORTED_MEDIA_TYPE' // 415（非対応 Content-Type）
  | 'REQUEST_TOO_LARGE' // 413
  | 'IMAGE_DECODE_FAILED' // 422（tf.node.decodeImage 失敗）
  | 'MODEL_UNAVAILABLE' // 503（CPU 非対応 / import・load 失敗）
  | 'DETECTION_FAILED'; // 500（classify 失敗 / タイムアウト / 未分類）

/**
 * レスポンスに載せる予測値。nsfwjs の `PredictionType` と構造的に互換だが、
 * className を `string` に緩めて「Misskey が任意のクラス名を find できる」契約を表す。
 */
export type Prediction = {
  className: string;
  probability: number;
};

export type DetectImageSuccessResult = {
  success: true;
  result: {
    // nsfwjs の生出力（全クラス、確率降順）をそのまま返す。
    predictions: Prediction[];
  };
};

export type DetectFailedResult = {
  success: false;
  error: {
    code: DetectErrorCode;
    // 人間向けの診断テキスト。API 契約上の意味は持たない（呼び出し元はコードのみで分岐する）。
    message: string;
  };
};

export type DetectImageResult = DetectImageSuccessResult | DetectFailedResult;

/**
 * バッチ推論の個別結果。成功なら predictions、失敗なら error を持つ。
 * バッチ全体は常に 200 を返す（部分成功を表現するため）。
 */
export type BatchItemResult =
  | { success: true; predictions: Prediction[] }
  | { success: false; error: { code: DetectErrorCode; message: string } };
