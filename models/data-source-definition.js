var app = require('../app');
var execFile = require('child_process').execFile;
var loopback = require('loopback');
var debug = require('debug')('workspace:data-source-definition');

/*
 TODOs
 
 - add a flag indicating if discover is supported
 
*/

/**
 * Defines a `DataSource` configuration.
 * @class DataSourceDefinition
 * @inherits Definition
 */

var DataSourceDefinition = app.models.DataSourceDefinition;

/**
 * - `name` must be unique per `Facet`
 * - `name` and `connector` are required
 * - `facetName` is required and must refer to an existing facet
 *
 * @header Property Validation
 */

DataSourceDefinition.validatesUniquenessOf('name', { scopedTo: ['facetName'] });
DataSourceDefinition.validatesPresenceOf('name', 'connector');
DataSourceDefinition.validatesPresenceOf('facetName');

/**
 * Test the datasource definition connection.
 *
 * @callback {Function} callback
 * @param {Error} err A connection or other error
 * @param {Boolean} success `true` if the connection was established
 */

DataSourceDefinition.prototype.testConnection = function(cb) {
  this.invokeMethodInWorkspace('ping', function(err) {
    if (!err) {
      return cb(null, true);
    }

    if (err.origin === 'invoke') {
      // report `ping` errors as a 200 result with error details, not a 500
      cb(null, false, {
        message: err.message,
        code: err.code,
        details: err.details,
        stack: err.stack
      });
    } else {
      cb(err);
    }
  });
};

loopback.remoteMethod(DataSourceDefinition.prototype.testConnection, {
  returns: [
    { arg: 'status', type: 'boolean' },
    { arg: 'error', type: 'Error' }
  ]
});

/**
 * Test the datasource connection (static version).
 *
 * @deprecated Use the prototype version.
 *
 * @param {Object} data DataSourceDefinition
 * @callback {Function} callback
 * @param {Error} err A connection or other error
 * @param {Boolean} success `true` if the connection was established
 */
DataSourceDefinition.testConnection = function(data, cb) {
  var def = new DataSourceDefinition(data);
  def.testConnection(cb);
};

DataSourceDefinition.remoteMethod('testConnection', {
  accepts: {
    arg: 'data', type: 'DataSourceDefinition', http: { source: 'body' }
  },
  returns: {
    arg: 'status', type: 'boolean'
  },
  http: { verb: 'POST' }
});

/**
 * Discover the model definition by table name from this data source. Use the `name`
 * provided by items from returned from `DataSourceDefinition.getSchema()`.
 *
 * @param {String} modelName The model name (usually from `DataSourceDefinition.getSchema()`.
 * @options {Object} [options] Options; see below.
 * @property {String} owner|schema Database owner or schema name.
 * @property {Boolean} relations True if relations (primary key/foreign key) are navigated; false otherwise.
 * @property {Boolean} all True if all owners are included; false otherwise.
 * @property {Boolean} views True if views are included; false otherwise.
 */

DataSourceDefinition.prototype.discoverModelDefinition = function(name, options, cb) {
  this.invokeMethodInWorkspace('discoverSchemas', name, options, cb);
}

loopback.remoteMethod(DataSourceDefinition.prototype.discoverModelDefinition, {
  accepts: [{
    arg: 'modelName', type: 'string'
  }, {
    arg: 'options', type: 'object'
  }],
  returns: { arg: 'status', type: 'boolean' }
});

/**
 * Get a list of table / collection names, owners and types.
 *
 * @param {Object} options The options
 * @param {Function} Callback function.  Optional.
 * @options {Object} options Discovery options.  See below.
 * @property {Boolean} all If true, discover all models; if false, discover only
 * models owned by the current user.
 * @property {Boolean} views If true, include views; if false, only tables.
 * @property {Number} limit Page size
 * @property {Number} offset Starting index
 * @callback {Function} callback
 * @param {Error} err
 * @param {ModelDefinition[]} models An array of model definitions
 */

DataSourceDefinition.prototype.getSchema = function(options, cb) {
  this.invokeMethodInWorkspace('discoverModelDefinitions', options, cb);
}

loopback.remoteMethod(DataSourceDefinition.prototype.getSchema, {
  accepts: { arg: 'options', type: 'object'},
  returns: { arg: 'models', type: 'array' }
});

/**
 * Run a migration on the data source. Creates indexes, tables, collections, etc.
 *
 * **NOTE: this will destroy any existing data**
 *
 * @param {string} modelName
 * @callback {Function} callback
 * @param {Error} err
 * @param {boolean} success
 */

DataSourceDefinition.prototype.automigrate = function(modelName, cb) {
  this.invokeMethodInWorkspace('automigrate', modelName, cb);
};

loopback.remoteMethod(DataSourceDefinition.prototype.automigrate, {
  accepts: {arg: 'modelName', type: 'string' },
  returns: { arg: 'success', type: 'boolean' },
  http: { verb: 'POST' }
});

/**
 * Update existing tables / collections.
 *
 * @param {string} modelName
 * @callback {Function} callback
 * @param {Error} err
 * @param {boolean} success
 */

DataSourceDefinition.prototype.autoupdate = function(modelName, cb) {
  this.invokeMethodInWorkspace('autoupdate', modelName, cb);
};

loopback.remoteMethod(DataSourceDefinition.prototype.autoupdate, {
  accepts: {arg: 'modelName', type: 'string' },
  returns: { arg: 'success', type: 'boolean' },
  http: { verb: 'POST' }
});

DataSourceDefinition.prototype.invokeMethodInWorkspace = function() {
  // TODO(bajtos) We should ensure there is never more than one instance
  // of this code running at any given time.
  var self = this;
  var methodArgs = Array.prototype.slice.call(arguments);
  var processArgs = [];
  var cb = args.pop();

  // remove optional parameters with 'undefined' value
  while (args[args.length-1] === undefined) args.pop();

  debug('invoke dataSource', args.map(JSON.stringify).join(' '));

  args.unshift(require.resolve('../bin/datasource-invoke'))
  execFile(
    process.execPath,
    args,
    {
      cwd: process.env.WORKSPACE_DIR,
      timeout: 90 * 1000,
    },
    function(err, stdout, stderr) {
      debug(
        '--invoke stdout--\n%s--invoke stderr--\n%s--invoke end--',
        stdout, stderr);

      if (err)
        cb(missingConnector(err) || invocationError(err) || err);
      else
        cb(null, true);

      function missingConnector(err) {
        var match = err.message.match(
          /LoopBack connector "(.*)" is not installed/
        );
        if (match && match[1] === self.connector) {
          var msg = 'Connector "' + self.connector + '" is not installed.';
          err = new Error(msg);
          err.name = 'InvocationError';
          err.code = 'ER_INVALID_CONNECTOR';
          return err;
        }
        return undefined;
      }

      function invocationError(err) {
        var match = err.message.match(
          /--datasource-invoke-error--\n((.|[\r\n])*)$/
        );
        if (match) {
          try {
            var errorData = JSON.parse(match[1]);
            err = new Error(errorData.message);
            err.name = 'InvocationError';
            for (var k in errorData.properties) {
              err[k] = errorData.properties[k];
            }
            err.origin = errorData.origin;
            err.stack = errorData.stack;
            return err;
          } catch(jsonerr) {
            debug('Cannot parse error JSON', jsonerr);
          }
        }
        return undefined;
      }
    });
}

/**
 * Create a `loopback.DataSource` object from the `DataSourceDefinition`.
 *
 * @deprecated Use `invokeMethodInWorkspace()` instead
 *
 * @returns {DataSource}
 */

DataSourceDefinition.prototype.toDataSource = function() {
  console.log('deprecated dataSourceDefinition.toDataSource()');
  return loopback.createDataSource(this.name, this);
}
