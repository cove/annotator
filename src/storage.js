/*package annotator.storage */

"use strict";

var util = require('./util');
var $ = util.$;
var _t = util.gettext;
var Promise = util.Promise;


// id returns an identifier unique within this session
var id = (function () {
    var counter;
    counter = -1;
    return function () {
        return counter += 1;
    };
}());


/**
 * data:: debugStorage
 *
 * A storage component that can be used to print details of the annotation
 * persistence processes to the console when developing other parts of
 * Annotator.
 */
exports.debugStorage = {
    trace: function trace(action, annotation) {
        var copyAnno = JSON.parse(JSON.stringify(annotation));
        console.debug("DebugStore: " + action, copyAnno);
    },

    create: function (annotation) {
        annotation.id = id();
        this.trace('create', annotation);
        return annotation;
    },

    update: function (annotation) {
        this.trace('update', annotation);
        return annotation;
    },

    'delete': function (annotation) {
        this.trace('destroy', annotation);
        return annotation;
    },

    query: function (queryObj) {
        this.trace('query', queryObj);
        return {results: [], meta: {total: 0}};
    }
};


/**
 * data:: nullStorage
 *
 * A no-op storage component. It swallows all calls and does the bare minimum
 * needed. Needless to say, it does not provide any real persistence.
 */
exports.nullStorage = {
    create: function (annotation) {
        if (typeof annotation.id === 'undefined' ||
            annotation.id === null) {
            annotation.id = id();
        }
        return annotation;
    },

    update: function (annotation) {
        return annotation;
    },

    'delete': function (annotation) {
        return annotation;
    },

    query: function () {
        return {results: []};
    }
};


/**
 * class:: HTTPStorageImpl([options])
 *
 * HTTPStorageImpl is a storage component that talks to a simple remote API that
 * can be implemented with any web framework.
 *
 * :param Object options: Configuration options.
 */
function HTTPStorageImpl(options) {
    this.options = $.extend(true, {}, HTTPStorageImpl.options, options);
    this.onError = this.options.onError;
}

/**
 * function:: HTTPStorageImpl.prototype.create(annotation)
 *
 * Create an annotation.
 *
 * **Examples**:
 *
 * ::
 *
 *     store.create({text: "my new annotation comment"})
 *     // => Results in an HTTP POST request to the server containing the
 *     //    annotation as serialised JSON.
 *
 * :param Object annotation: An annotation.
 * :returns jqXHR: The request object.
 */
HTTPStorageImpl.prototype.create = function (annotation) {
    return this._apiRequest('create', annotation);
};

/**
 * function:: HTTPStorageImpl.prototype.update(annotation)
 *
 * Update an annotation.
 *
 * **Examples**:
 *
 * ::
 *
 *     store.update({id: "blah", text: "updated annotation comment"})
 *     // => Results in an HTTP PUT request to the server containing the
 *     //    annotation as serialised JSON.
 *
 * :param Object annotation: An annotation. Must contain an `id`.
 * :returns jqXHR: The request object.
 */
HTTPStorageImpl.prototype.update = function (annotation) {
    return this._apiRequest('update', annotation);
};

/**
 * function:: HTTPStorageImpl.prototype.delete(annotation)
 *
 * Delete an annotation.
 *
 * **Examples**:
 *
 * ::
 *
 *     store.delete({id: "blah"})
 *     // => Results in an HTTP DELETE request to the server.
 *
 * :param Object annotation: An annotation. Must contain an `id`.
 * :returns jqXHR: The request object.
 */
HTTPStorageImpl.prototype['delete'] = function (annotation) {
    return this._apiRequest('destroy', annotation);
};

/**
 * function:: HTTPStorageImpl.prototype.query(queryObj)
 *
 * Searches for annotations matching the specified query.
 *
 * :param Object queryObj: An object describing the query.
 * :returns Promise:
 *   Resolves to an object containing query `results` and `meta`.
 */
HTTPStorageImpl.prototype.query = function (queryObj) {
    var dfd = $.Deferred();
    this._apiRequest('search', queryObj)
        .done(function (obj) {
            var rows = obj.rows;
            delete obj.rows;
            dfd.resolve({results: rows, meta: obj});
        })
        .fail(function () {
            dfd.reject.apply(dfd, arguments);
        });
    return dfd.promise();
};

/**
 * function:: HTTPStorageImpl.prototype.setHeader(name, value)
 *
 * Set a custom HTTP header to be sent with every request.
 *
 * **Examples**:
 *
 * ::
 *
 *     store.setHeader('X-My-Custom-Header', 'MyCustomValue')
 *
 * :param string name: The header name.
 * :param string value: The header value.
 */
HTTPStorageImpl.prototype.setHeader = function (key, value) {
    this.options.headers[key] = value;
};

/*
 * Helper method to build an XHR request for a specified action and
 * object.
 *
 * :param String action: The action: "search", "create", "update" or "destroy".
 * :param obj: The data to be sent, either annotation object or query string.
 *
 * :returns jqXHR: The request object.
 */
HTTPStorageImpl.prototype._apiRequest = function (action, obj) {
    var id = obj && obj.id;
    var url = this._urlFor(action, id);
    var options = this._apiRequestOptions(action, obj);

    var request = $.ajax(url, options);

    // Append the id and action to the request object
    // for use in the error callback.
    request._id = id;
    request._action = action;
    return request;
};

/*
 * Builds an options object suitable for use in a jQuery.ajax() call.
 *
 *  :param String action: The action: "search", "create", "update" or "destroy".
 *  :param obj: The data to be sent, either annotation object or query string.
 *
 *  :returns Object: $.ajax() options.
 */
HTTPStorageImpl.prototype._apiRequestOptions = function (action, obj) {
    var method = this._methodFor(action);

    var opts = {
        type: method,
        dataType: "json",
        error: this._onError,
        headers: this.options.headers
    };

    // If emulateHTTP is enabled, we send a POST and put the real method in an
    // HTTP request header.
    if (this.options.emulateHTTP && (method === 'PUT' || method === 'DELETE')) {
        opts.headers = $.extend(opts.headers, {
            'X-HTTP-Method-Override': method
        });
        opts.type = 'POST';
    }

    // Don't JSONify obj if making search request.
    if (action === "search") {
        opts = $.extend(opts, {data: obj});
        return opts;
    }

    var data = obj && JSON.stringify(obj);

    // If emulateJSON is enabled, we send a form request (the correct
    // contentType will be set automatically by jQuery), and put the
    // JSON-encoded payload in the "json" key.
    if (this.options.emulateJSON) {
        opts.data = {json: data};
        if (this.options.emulateHTTP) {
            opts.data._method = method;
        }
        return opts;
    }

    opts = $.extend(opts, {
        data: data,
        contentType: "application/json; charset=utf-8"
    });
    return opts;
};

/*
 * Builds the appropriate URL from the options for the action provided.
 *
 * :param String action:
 * :param id: The annotation id as a String or Number.
 *
 * :returns String: URL for the request.
 */
HTTPStorageImpl.prototype._urlFor = function (action, id) {
    if (typeof id === 'undefined' || id === null) {
        id = '';
    }

    var url = '';
    if (typeof this.options.prefix !== 'undefined' &&
        this.options.prefix !== null) {
        url = this.options.prefix;
    }

    url += this.options.urls[action];
    // If there's an '{id}' in the URL, then fill in the ID.
    url = url.replace(/\{id\}/, id);
    return url;
};

/*
 * Maps an action to an HTTP method.
 *
 * :param String action:
 * :returns String: Method for the request.
 */
HTTPStorageImpl.prototype._methodFor = function (action) {
    var table = {
        create: 'POST',
        update: 'PUT',
        destroy: 'DELETE',
        search: 'GET'
    };

    return table[action];
};

/*
 * jQuery.ajax() callback. Displays an error notification to the user if
 * the request failed.
 *
 * :param jqXHR: The jqXMLHttpRequest object.
 */
HTTPStorageImpl.prototype._onError = function (xhr) {
    var action = xhr._action;
    var message = _t("Sorry we could not ") + action + _t(" this annotation");

    if (xhr._action === 'search') {
        message = _t("Sorry we could not search the store for annotations");
    }

    if (xhr.status === 401) {
        message = _t("Sorry you are not allowed to ") +
                  action +
                  _t(" this annotation");
    } else if (xhr.status === 404) {
        message = _t("Sorry we could not connect to the annotations store");
    } else if (xhr.status === 500) {
        message = _t("Sorry something went wrong with the annotation store");
    }

    if (typeof this.onError === 'function') {
        this.onError(message, xhr);
    }
};

/**
 * attribute:: HTTPStorageImpl.options
 *
 * Available configuration options for HTTPStorageImpl.
 */
HTTPStorageImpl.options = {
    /**
     * attribute:: HTTPStorageImpl.options.emulateHTTP
     *
     * Should the plugin emulate HTTP methods like PUT and DELETE for
     * interaction with legacy web servers? Setting this to `true` will fake
     * HTTP `PUT` and `DELETE` requests with an HTTP `POST`, and will set the
     * request header `X-HTTP-Method-Override` with the name of the desired
     * method.
     *
     * **Default**: ``false``
     */
    emulateHTTP: false,

    /**
     * attribute:: HTTPStorageImpl.options.emulateJSON
     *
     * Should the plugin emulate JSON POST/PUT payloads by sending its requests
     * as application/x-www-form-urlencoded with a single key, "json"
     *
     * **Default**: ``false``
     */
    emulateJSON: false,

    /**
     * attribute:: HTTPStorageImpl.options.headers
     *
     * A set of custom headers that will be sent with every request. See also
     * the setHeader method.
     *
     * **Default**: ``{}``
     */
    headers: {},

    /**
     * attribute:: HTTPStorageImpl.options.onError
     *
     * Callback, called if a remote request throws an error.
     */
    onError: function (message) {
        console.error("API request failed: " + message);
    },

    /**
     * attribute:: HTTPStorageImpl.options.prefix
     *
     * This is the API endpoint. If the server supports Cross Origin Resource
     * Sharing (CORS) a full URL can be used here.
     *
     * **Default**: ``'/store'``
     */
    prefix: '/store',

    /**
     * attribute:: HTTPStorageImpl.options.urls
     *
     * The server URLs for each available action. These URLs can be anything but
     * must respond to the appropriate HTTP method. The URLs are Level 1 URI
     * Templates as defined in RFC6570:
     *
     *    http://tools.ietf.org/html/rfc6570#section-1.2
     */
    urls: {
        create: '/annotations',
        update: '/annotations/{id}',
        destroy: '/annotations/{id}',
        search: '/search'
    }
};


// FIXME: Remove the need for this wrapper function.
function HTTPStorage(options) {
    return new HTTPStorageImpl(options);
}


/**
 * class:: StorageAdapter(store, runHook)
 *
 * StorageAdapter wraps a concrete implementation of the Storage interface, and
 * ensures that the appropriate hooks are fired when annotations are created,
 * updated, deleted, etc.
 *
 * :param store: The Store implementation which manages persistence
 * :param Function runHook: A function which can be used to run lifecycle hooks
 */
function StorageAdapter(store, runHook) {
    this.store = store;
    this.runHook = runHook;
}

/**
 * function:: StorageAdapter.prototype.create(obj)
 *
 * Creates and returns a new annotation object.
 *
 * Runs the 'beforeAnnotationCreated' hook to allow the new annotation to be
 * initialized or its creation prevented.
 *
 * Runs the 'annotationCreated' hook when the new annotation has been created
 * by the store.
 *
 * **Examples**:
 *
 * ::
 *
 *     registry.on('beforeAnnotationCreated', function (annotation) {
 *         annotation.myProperty = 'This is a custom property';
 *     });
 *     registry.create({}); // Resolves to {myProperty: "This is a…"}
 *
 *
 * :param Object annotation: An object from which to create an annotation.
 * :returns Promise: Resolves to annotation object when stored.
 */
StorageAdapter.prototype.create = function (obj) {
    if (typeof obj === 'undefined' || obj === null) {
        obj = {};
    }
    return this._cycle(
        obj,
        'create',
        'onBeforeAnnotationCreated',
        'onAnnotationCreated'
    );
};

/**
 * function:: StorageAdapter.prototype.update(obj)
 *
 * Updates an annotation.
 *
 * Runs the 'beforeAnnotationUpdated' hook to allow an annotation to be
 * modified before being passed to the store, or for an update to be prevented.
 *
 * Runs the 'annotationUpdated' hook when the annotation has been updated by
 * the store.
 *
 * **Examples**:
 *
 * ::
 *
 *     annotation = {tags: 'apples oranges pears'};
 *     registry.on('beforeAnnotationUpdated', function (annotation) {
 *         // validate or modify a property.
 *         annotation.tags = annotation.tags.split(' ')
 *     });
 *     registry.update(annotation)
 *     // => Resolves to {tags: ["apples", "oranges", "pears"]}
 *
 * :param Object annotation: An annotation object to update.
 * :returns Promise: Resolves to annotation object when stored.
 */
StorageAdapter.prototype.update = function (obj) {
    if (typeof obj.id === 'undefined' || obj.id === null) {
        throw new TypeError("annotation must have an id for update()");
    }
    return this._cycle(
        obj,
        'update',
        'onBeforeAnnotationUpdated',
        'onAnnotationUpdated'
    );
};

/**
 * function:: StorageAdapter.prototype.delete(obj)
 *
 * Deletes the annotation.
 *
 * Runs the 'beforeAnnotationDeleted' hook to allow an annotation to be
 * modified before being passed to the store, or for the a deletion to be
 * prevented.
 *
 * Runs the 'annotationDeleted' hook when the annotation has been deleted by
 * the store.
 *
 * :param Object annotation: An annotation object to delete.
 * :returns Promise: Resolves to annotation object when deleted.
 */
StorageAdapter.prototype['delete'] = function (obj) {
    if (typeof obj.id === 'undefined' || obj.id === null) {
        throw new TypeError("annotation must have an id for delete()");
    }
    return this._cycle(
        obj,
        'delete',
        'onBeforeAnnotationDeleted',
        'onAnnotationDeleted'
    );
};

/**
 * function:: StorageAdapter.prototype.query(query)
 *
 * Queries the store
 *
 * :param Object query:
 *   A query. This may be interpreted differently by different stores.
 *
 * :returns Promise: Resolves to the store return value.
 */
StorageAdapter.prototype.query = function (query) {
    return Promise.resolve(this.store.query(query));
};

/**
 * function:: StorageAdapter.prototype.load(query)
 *
 * Load and draw annotations from a given query.
 *
 * Runs the 'load' hook to allow plugins to respond to annotations being loaded.
 *
 * :param Object query:
 *   A query. This may be interpreted differently by different stores.
 *
 * :returns Promise: Resolves when loading is complete.
 */
StorageAdapter.prototype.load = function (query) {
    var self = this;
    return this.query(query)
        .then(function (data) {
            self.runHook('onAnnotationsLoaded', [data.results]);
        });
};

// Cycle a store event, keeping track of the annotation object and updating it
// as necessary.
StorageAdapter.prototype._cycle = function (
    obj,
    storeFunc,
    beforeEvent,
    afterEvent
) {
    var self = this;
    return this.runHook(beforeEvent, [obj])
        .then(function () {
            var safeCopy = $.extend(true, {}, obj);
            delete safeCopy._local;

            // We use Promise.resolve() to coerce the result of the store
            // function, which can be either a value or a promise, to a promise.
            var result = self.store[storeFunc](safeCopy);
            return Promise.resolve(result);
        })
        .then(function (ret) {
            // Empty obj without changing identity
            for (var k in obj) {
                if (obj.hasOwnProperty(k)) {
                    if (k !== '_local') {
                        delete obj[k];
                    }
                }
            }

            // Update with store return value
            $.extend(obj, ret);
            self.runHook(afterEvent, [obj]);
            return obj;
        });
};


exports.HTTPStorage = HTTPStorage;
exports.StorageAdapter = StorageAdapter;
