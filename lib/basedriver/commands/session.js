import _ from 'lodash';
import log from '../logger';
import { errors } from '../../mjsonwp';
import UUID from 'uuid-js';
import { processCapabilities } from '../capabilities';

let commands = {};

commands.createSession = async function (desiredCapabilities, requiredCaps, capabilities) {
  if (this.sessionId !== null) {
    throw new errors.SessionNotCreatedError('Cannot create a new session ' +
                                            'while one is in progress');
  }

  // If we were provided with W3C capabilities, parse those. Otherwise, fall back to MJSONWP.
  let caps = capabilities ?
    processCapabilities(capabilities, this.desiredCapConstraints, this.shouldValidateCaps) :
    desiredCapabilities;

  caps = fixCaps(caps, this.desiredCapConstraints);
  this.validateDesiredCaps(caps);

  this.sessionId = UUID.create().hex;
  this.caps = caps;
  this.opts = _.cloneDeep(this.initialOpts);

  // merge caps onto opts so we don't need to worry about what's where
  Object.assign(this.opts, this.caps);

  // deal with resets
  // some people like to do weird things by setting noReset and fullReset
  // both to true, but this is misguided and strange, so error here instead
  if (this.opts.noReset && this.opts.fullReset) {
    throw new Error("The 'noReset' and 'fullReset' capabilities are mutually " +
                    "exclusive and should not both be set to true. You " +
                    "probably meant to just use 'fullReset' on its own");
  }
  if (this.opts.noReset === true) {
    this.opts.fullReset = false;
  }
  if (this.opts.fullReset === true) {
    this.opts.noReset = false;
  }
  this.opts.fastReset = !this.opts.fullReset && !this.opts.noReset;
  this.opts.skipUninstall = this.opts.fastReset || this.opts.noReset;

  // Prevents empty string caps so we don't need to test it everywhere
  if (typeof this.opts.app === 'string' && this.opts.app.trim() === '') {
    this.opts.app = null;
  }

  if (!_.isUndefined(this.caps.newCommandTimeout)) {
    this.newCommandTimeoutMs = (this.caps.newCommandTimeout * 1000);
  }

  // We need to ininitialize one onUnexpectedShutdow promise per session
  // to avoid the promise fulfilment being propagated between sessions.
  this.resetOnUnexpectedShutdown();

  log.info(`Session created with session id: ${this.sessionId}`);

  return [this.sessionId, caps];
};

commands.getSessions = async function () {
  let ret = [];

  if (this.sessionId) {
    ret.push({
      id: this.sessionId,
      capabilities: this.caps
    });
  }

  return ret;
};

commands.getSession = async function () {
  if (this.caps.eventTimings) {
    return Object.assign({}, this.caps, {events: this.eventHistory});
  }
  return this.caps;
};

commands.deleteSession = async function (/* sessionId */) {
  this.clearNewCommandTimeout();
  this.sessionId = null;
};

function fixCaps (originalCaps, desiredCapConstraints = {}) {
  let caps = _.clone(originalCaps);

  // boolean capabilities can be passed in as strings 'false' and 'true'
  // which we want to translate into boolean values
  let booleanCaps = _.keys(_.pickBy(desiredCapConstraints, (k) => k.isBoolean === true));
  for (let cap of booleanCaps) {
    let value = originalCaps[cap];
    if (_.isString(value)) {
      value = value.toLowerCase();
      if (value === 'true' || value === 'false') {
        log.warn(`Capability '${cap}' changed from string to boolean. This may cause unexpected behavior`);
        caps[cap] = (value === 'true');
      }
    }
  }

  // int capabilities are often sent in as strings by frameworks
  let intCaps = _.keys(_.pickBy(desiredCapConstraints, (k) => k.isNumber === true));
  for (let cap of intCaps) {
    let value = originalCaps[cap];
    if (_.isString(value)) {
      let newValue = parseInt(value, 10);
      if (value.indexOf('.') !== -1) {
        newValue = parseFloat(value);
      }
      log.warn(`Capability '${cap}' changed from string ('${value}') to integer (${newValue}). This may cause unexpected behavior`);
      caps[cap] = newValue;
    }
  }

  return caps;
}

export default commands;
