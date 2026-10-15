// Converts Simplified Chinese transcripts to Traditional Chinese with Taiwan
// phrasing. Text that is already Traditional, or not Chinese, passes through.

let converter = null;
let converterLoadFailed = false;

function getConverter() {
  if (converter || converterLoadFailed) {
    return converter;
  }

  try {
    const OpenCC = require('opencc-js');
    converter = OpenCC.Converter({ from: 'cn', to: 'twp' });
  } catch (error) {
    converterLoadFailed = true;
    console.error('Failed to load opencc-js; transcripts will not be converted:', error.message);
  }

  return converter;
}

function toTraditionalChinese(text) {
  const value = String(text || '');
  if (!value) {
    return value;
  }

  const convert = getConverter();
  return convert ? convert(value) : value;
}

module.exports = {
  toTraditionalChinese
};
