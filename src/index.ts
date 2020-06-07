import fs from 'fs-extra'
import { join } from 'path'
import { promisify } from 'util'
import { uniq, isString, isObject, last } from 'lodash-es'
import {
  SUPPORTED_LANGUAGES,
  generateWrapperCode,
  generateWrapperExt,
} from './handlers'

const mkdir = fs.mkdirpSync
const writeFile = promisify(fs.writeFile)

const VALIDATE_LIB_BY_LANG = {
  async node() {
    let pack
    try {
      pack = await fs.readJson(this.config().packageJsonPath || (join(this.prefix, 'package.json')))
    } catch (err) {
      this.log('Could not read package.json. Skipping recap.dev library validation - please make sure you have it installed!')
      return
    }
    const { dependencies = [] } = pack
    if (!Object.keys(dependencies).some((dep) => dep === '@recap.dev/client')) {
      throw new Error('@recap.dev/client Node library must be installed in order to use this plugin!')
    }
  },
}

export default class ServerlessRecapDevPlugin {
  private sls: any

  private prefix: string

  private funcs: any[]

  private originalServicePath: string

  private commands: any

  private hooks: any

  constructor(sls = {}, opts) {
    this.sls = sls
    this.prefix = opts.prefix
      || this.sls.config.servicePath
      || process.env.npm_config_prefix
    this.funcs = []
    this.originalServicePath = this.sls.config.servicePath
    this.commands = {
      recap: {
        usage:
          'Automatically wraps your function handlers with recap.dev',
        lifecycleEvents: ['run', 'clean'],
        commands: {
          clean: {
            usage: 'Cleans up extra recap.dev files if necessary',
            lifecycleEvents: ['init'],
          },
          run: {
            usage: 'Generates recap.dev handlers',
            lifecycleEvents: ['init'],
          },
        },
      },
    }

    this.hooks = {
      'after:package:initialize': this.run.bind(this),
      'before:deploy:function:packageFunction': this.run.bind(this),
      'before:invoke:local:invoke': this.run.bind(this),
      'before:offline:start:init': this.run.bind(this),
      'before:step-functions-offline:start': this.run.bind(this),
      'after:package:createDeploymentArtifacts': this.cleanup.bind(this),
      'after:invoke:local:invoke': this.cleanup.bind(this),
      'recap:clean:init': this.cleanup.bind(this),
      'recap:run:init': this.run.bind(this),
    }
  }

  log(format, ...args) {
    this.sls.cli.log(`[@recap.dev/serverless-plugin] ${format}`, ...args)
  }

  async run() {
    if (this.config().disable && this.config().disable.toString().toLowerCase() === 'true') {
      this.log('recap.dev disabled - not wrapping functions')
      return
    }
    this.log('Wrapping your functions with recap.dev...')
    fs.removeSync(join(this.originalServicePath, this.config().handlersDirName))
    this.funcs = this.findFuncs()
    await this.validateLib()
    await this.generateHandlers()
    this.assignHandlers()
  }

  async validateLib() {
    const languages = uniq(this.funcs.map((func) => func.language))
    await Promise.all(languages.map(async (lang) => {
      await VALIDATE_LIB_BY_LANG[lang].bind(this)()
    }))
  }

  findFuncs() {
    return Object.entries(this.sls.service.functions)
      .reduce((result: any[], pair: [string, any]) => {
        const [key, func] = pair
        const runtime = func.runtime || this.sls.service.provider.runtime
        const { disable } = func['recap-dev'] || {}
        const handler = isString(func.handler) ? func.handler.split('.') : []
        const relativePath = handler.slice(0, -1).join('.')

        if (disable) {
          this.log(`recap.dev is disabled for function ${key}, skipping.`)
          return result
        }

        if (!isString(runtime)) {
          return result
        }

        const language = SUPPORTED_LANGUAGES.find(((lang) => runtime.match(lang)))
        if (!language) {
          this.log(`Runtime "${runtime}" is not supported yet, skipping function ${key}`)
          return result
        }

        result.push(Object.assign(func, {
          method: last(handler),
          key,
          relativePath,
          language,
          recapHandler: `${key}-recap-dev`,
        }))
        return result
      }, [])
  }

  async generateHandlers() {
    const handlersFullDirPath = join(
      this.originalServicePath,
      this.config().handlersDirName,
    )
    try {
      mkdir(handlersFullDirPath)
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw err
      }
    }
    await Promise.all(this.funcs.map(async (func) => {
      const handlerCode = generateWrapperCode(func)
      await writeFile(
        join(
          handlersFullDirPath,
          generateWrapperExt(func),
        ),
        handlerCode,
      )
    }))
  }

  assignHandlers() {
    this.funcs.forEach((func) => {
      const handlerPath = `${this.config().handlersDirName.replace('\\', '/')}/${func.recapHandler}`
      const serviceFunc = this.sls.service.functions[func.key]
      serviceFunc.handler = `${handlerPath}.${func.method}`

      // Adding handler to include (in case it was excluded).
      if (isObject(serviceFunc.package) && isObject(serviceFunc.package.include)) {
        serviceFunc.package.include = [...serviceFunc.package.include, handlerPath]
      }
    })

    // Adding the general recap.dev_handlers dir to include (in case it was excluded).
    if (isObject(this.sls.service.package.include)) {
      this.sls.service.package.include = [
        ...this.sls.service.package.include,
        `${this.config().handlersDirName.replace('\\', '/')}/**`,
      ]
    }
  }

  config() {
    return {
      handlersDirName: 'recap.dev_handlers',
      ...(this.sls.service.custom || {})['recap-dev'] || {},
    }
  }

  cleanup() {
    this.log('Cleaning up recap.dev handlers')
    fs.removeSync(join(this.originalServicePath, this.config().handlersDirName))
  }
}
