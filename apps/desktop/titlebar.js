'use strict';

const HEIGHT = 32;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function isTitleBarTheme(value) {
  return value != null
    && typeof value.color === 'string'
    && typeof value.symbolColor === 'string'
    && HEX_COLOR.test(value.color)
    && HEX_COLOR.test(value.symbolColor);
}

function isIconDataURL(value) {
  return typeof value === 'string'
    && value.length < 300_000
    && /^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})+(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

module.exports = { HEIGHT, isTitleBarTheme, isIconDataURL };
