const WRAPPER_CODE = {
  node: `
  const recap = require('@recap.dev/client')
  const handler = require('../RELATIVE_PATH.js');

  exports.METHOD = recap.wrapLambdaHandler(handler.METHOD);
`,
}

const FILE_NAME_BY_LANG_GENERATORS = {
  node: ((name) => `${name}.js`),
}

export const SUPPORTED_LANGUAGES = Object.keys(WRAPPER_CODE)

export function generateWrapperCode(
  func,
) {
  return WRAPPER_CODE[func.language]
    .replace(/RELATIVE_PATH/g, func.relativePath)
    .replace(/METHOD/g, func.method)
}

export function generateWrapperExt(func) {
  return FILE_NAME_BY_LANG_GENERATORS[func.language](func.recapHandler)
}
