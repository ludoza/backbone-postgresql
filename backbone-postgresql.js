Backbone = require('backbone'), _ = require('underscore');
/**
 * Backbone-postgresql extend the Backbone Model and Collection to easily
 * read and write from tables and views
 * 
 * You must extend the model with the following properties for Backbone-postgresql
 * to work:
 * 
 * urlRoot or tableName: urlRoot is included for legacy purposes, where tableName
 * is the prefered method to specify your table or view name to user.
 *
 * idAttribute: Backbone-postgresql assumes the primary key for the table is 'id'.
 * If this is not you need to specify the correct primary key for the table.
 * 
 * 
 */
(function () {
    var con;

    Backbone.pg_connector = con = {

        config: undefined,

        connect: function (cb) {
            if (this.config.db === undefined || this.config.db.client === undefined) 
            if (this.config.db !== undefined) {
                this.pg = this.pg || require('pg');
                this.pg.connect(this.config.db, cb);                
            } else 
            if (this.config.client !== undefined) {
                cb(undefined, this.config.client);                
            } 
            else throw new Error("You must define the config");

            
            if (con.config.debug === undefined) {
            	con.config.debug = function(msg) {
            		// silent;
            	};
            };
        },

        read: function (model, options) {
            var self = this;
            model.load_attributes(function () {
                con.connect(function (err, client) {
                    if (err) Error(err);
                    var attr_query = (model.has_attributes() ? ', %# attributes as attributes' : '');
                    options.relation_conds = model.relation_conds();
                    var filter = model.filter_query(options, ' AND ');
                    var qry = 'SELECT *' + attr_query + ' FROM ' + model.table_name() + ' WHERE ' + model.idAttribute + ' = $1' + filter;
                    con.config.debug('read query = ' + JSON.stringify( {
						text: qry,
						value: [model.id]
					}));
                    client.query(qry, [model.id],function (err, result) {
                        if (err) return options.error(model, err);
                        if (result.rows.length == 0) return options.error(model, new Error("Not found"));
                        options.success(model.merge_incoming_attributes(result.rows[0]));
                    });
                });
            });
        },

        create: function (model, options) {
            model.columns(function (columns) {
                var existing_keys = columns ? columns.map(function (attr) {
                    return attr.name
                }) : [];
                var attr_query = (model.has_attributes() ? ', %# attributes as attributes' : '');
                var keys = [];
                var values = [];
                var dollars = [];
                var hstore_attrs = {};
                var dollar_counter = 1;
                _.extend(model.attributes, model.relation_conds());
                for (var key in model.attributes) {
                    if (existing_keys.indexOf(key) != -1) {
                        keys.push(key);
                        values.push(model.attributes[key]);
                        dollars.push('$' + dollar_counter++);
                    } else if (con.config.hstore) {
                        if (model.has_attributes()) {
                            hstore_attrs[key] = model.attributes[key];
                        }
                    } else throw new Error("Column '" + key + "' not found in table '" + model.table_name() + "'")
                }
                if (con.config.hstore && _.keys(hstore_attrs).length > 0) {
                    keys.push('attributes');
                    dollars.push('$' + dollar_counter++);
                    values.push(con.toHstore(hstore_attrs));
                }
                con.connect(function (err, client) {
                    var value_str = ' DEFAULT VALUES';
                    if (_.keys(keys).length > 0) {
                        value_str = ' (' + keys.join(',') + ') VALUES (' + dollars.join(',') + ')'
                    }
                    var qry = 'INSERT INTO ' + model.table_name() + value_str + ' RETURNING *' + attr_query;
                    con.config.debug('create query = ' + JSON.stringify( {
						text: qry,
						value: values
					}));
                    client.query(qry, values, function (err, result) {
                        if (err) return options.error(model, err);
                        options.success(model.merge_incoming_attributes(result.rows[0]));
                    });
                });
            });
        },

        update: function (model, options) {
            model.columns(function (columns) {
                var existing_keys = columns.map(function (attr) {
                    return attr.name
                });
                var attr_query = (model.has_attributes() ? ', %# attributes as attributes' : '');
                var keys = [];
                var values = [];
                var hstore_attrs = {};
                var dollar_counter = 1;
                for (var key in model.attributes) {
                    if (existing_keys.indexOf(key) != -1) {
                        if (key != model.idAttribute) {
                            keys.push(key + ' = $' + dollar_counter++);
                            values.push(model.attributes[key]);
                        }
                    } else if (con.config.hstore) {
                        if (model.has_attributes()) {
                            hstore_attrs[key] = model.attributes[key];
                        }
                    } else throw new Error("Column '" + key + "' not found in table '" + model.table_name() + "'")
                }
                if (con.config.hstore && _.keys(hstore_attrs).length > 0) {
                    keys.push('attributes = $' + dollar_counter++);
                    values.push(con.toHstore(hstore_attrs));
                }
                values.push(model.id);
                con.connect(function (err, client) {
                	var qry = 'UPDATE ' + model.table_name() + ' SET ' + keys.join(', ') + ' WHERE ' + model.idAttribute + ' = $' + dollar_counter + ' RETURNING *' + attr_query;
                	con.config.debug('update query = ' + JSON.stringify( {
						text: qry,
						value: values
					}));
                    client.query(qry, values, function (err, result) {
                        if (err) return options.error(model, err);
                        if (result.rows.length == 0) return options.error(model, new Error("Not found"));
                        options.success(model.merge_incoming_attributes(result.rows[0]));
                    });
                });
            });
        },

        delete: function (model, options) {
            con.connect(function (err, client) {
                options.relation_conds = model.relation_conds()
                var where_clause = model.filter_query(options, ' AND ');
                var qry = 'DELETE FROM ' + model.table_name() + ' WHERE ' + model.idAttribute + ' = $1' + where_clause + ' RETURNING ' + model.idAttribute;
                con.config.debug('delete query = ' + JSON.stringify( {
					text: qry,
					value: [model.id]
				}));                
                client.query(qry, [model.id], function (err, result) {
                    if (err) return options.error(model, err);
                    if (result.rows.length == 0) return options.error(model, new Error("Not found"));
                    options.success();
                });
            });
        },

        read_collection: function (collection, options) {
            con.connect(function (err, client) {
                var model = new collection.model();
                model.tableName = collection.tableName || model.tableName; 
                model.idAttribute = collection.idAttribute || model.idAttribute; 
                model.load_attributes(function () {
                    options.relation_conds = collection.relation_conds();
                    var where_clause = model.filter_query(options, ' WHERE ');
                    var qry = 'SELECT * FROM ' + collection.table_name() + where_clause + ' ORDER BY ' + model.idAttribute;
                    con.config.debug('read collection query = ' + JSON.stringify( {
						text: qry,
						value: []
					}));
                    client.query(qry, [], function (err, result) {
                        if (err) return options.error(collection, err);
                        options.success(result.rows);
                        collection.trigger('fetched');
                    });
                });
            });
        },

        toHstore: function (object) {
            var elements, key, val;
            elements = (function () {
                var _results;
                _results = [];
                for (key in object) {
                    val = object[key];
                    switch (typeof val) {
                    case "boolean":
                        val = (val ? this.quoteAndEscape("true") : this.quoteAndEscape("false"));
                        break;
                    case "object":
                        val = (val ? this.quoteAndEscape(JSON.stringify(val)) : "NULL");
                        break;
                    case "null":
                        val = "NULL";
                        break;
                    case "number":
                        val = (isFinite(val) ? this.quoteAndEscape(JSON.stringify(val)) : "NULL");
                        break;
                    default:
                        val = this.quoteAndEscape(val);
                    }
                    _results.push("\"" + key + "\"=>" + val);
                }
                return _results;
            }).call(this);
            return elements.join(", ");
        },

        quoteAndEscape: function (string) {
            return "\"" + String(string).replace(/"/g, "\\\"") + "\"";
        }

    }
	
    Backbone.Model.column_defs = {};
                               
    Backbone.Model.prototype.load_attributes = function (cb) {
        var self = this;
        if (!(this.table_name() in Backbone.Model.column_defs)) {
            con.connect(function (err, client) {
				var qry = "SELECT a.attname as name, format_type(a.atttypid, a.atttypmod) as type, d.adsrc as default, a.attnotnull as not_null \
							FROM pg_attribute a\
							LEFT JOIN pg_attrdef d\
								ON	a.attrelid = d.adrelid\
								AND a.attnum = d.adnum\
							WHERE a.attrelid = '" + self.table_name() + "'::regclass AND a.attnum > 0\
							AND NOT a.attisdropped\
							ORDER BY a.attnum";
				con.config.debug('load attributes query = ' + JSON.stringify( {
					text: qry,
					value: []
				}));
                client.query(qry, [], function (err, result) {
                    if (err) {
                        Backbone.Model.column_defs[self.table_name()] = [];
                    } else {
                        Backbone.Model.column_defs[self.table_name()] = result.rows || [];
                    }
                    cb();
                });
            });
        } else {
            cb();
        }
    }

    Backbone.Model.prototype.table_name = function () {
        var split_url = this.tableName || this.urlRoot;
        split_url = split_url.split('/');
        return split_url[split_url.length - 1];
    }

    Backbone.Model.prototype.columns = function (cb) {
        var self = this;
        this.load_attributes(function () {
            cb(Backbone.Model.column_defs[self.table_name()]);
        });
    }

    Backbone.Model.prototype.has_attributes = function () {
        if (this.table_name() in Backbone.Model.column_defs) {
            for (var attr_id in Backbone.Model.column_defs[this.table_name()]) {
                if (Backbone.Model.column_defs[this.table_name()][attr_id].name == 'attributes' && Backbone.Model.column_defs[this.table_name()][attr_id].type == 'hstore') return true;
            }
        }
        return false;
    }

    Backbone.Model.prototype.merge_incoming_attributes = function (incoming) {
        if (this.has_attributes()) {
            var hstore_attrs = incoming.attributes;
            delete incoming.attributes;
            if (hstore_attrs) {
                hstore_attrs.map(function (attr) {
                    incoming[attr[0]] = incoming[attr[0]] || attr[1];
                });
            }
        }
        return incoming;
    }

    Backbone.Model.prototype.quote = function (column_name, value) {
        var col_type = null;
        Backbone.Model.column_defs[this.table_name()].map(function (col) {
            if (col.name === column_name) col_type = col.type
        });
        if (col_type === 'text' || !! col_type.match(/character varying/)) return "'" + value + "'";
        return value;
    }

    Backbone.Model.prototype.filter_query = function (options, prefix, cb) {
        var self = this;
        var conds = [];
        if (!prefix) prefix = '';
        // Process the filter parameter to further filter the select
        if ('filter' in options) {
            if (options.filter instanceof Array) {
                conds = options.filter;
            } else if (options.filter instanceof Object) {
                conds = _.keys(options.filter).map(function (i) {
                    return i + ' = ' + self.quote(i, options.filter[i])
                });
            }
        }
        if ('relation_conds' in options) {
            conds = conds.concat(_.keys(options.relation_conds).map(function (i) {
                return i + ' = ' + self.quote(i, options.relation_conds[i])
            }));
        }
        if (conds.length == 0) return '';
        return prefix + conds.join(' AND ');
    }

    var old_fn = Backbone.Collection.prototype._onModelEvent;
    Backbone.Collection.prototype._onModelEvent = function (ev, model, collection, options) {
        if (ev == 'add') _.extend(model.attributes, collection.relation_conds());
        old_fn(ev, model, collection, options);
    }

    Backbone.Collection.prototype.table_name = function () {
    	if ( !this.tableName && this.model)
			this.tableName = this.model.prototype.tableName;
        var split_url = this.tableName || this.urlRoot;
        split_url = _.reject(split_url.split('/'), function (elem) {
            return elem === ''
        });
        return split_url[split_url.length - 1];
    }

    Backbone.Collection.prototype.relation_conds = function () {
		if ( !this.tableName && this.model)
			this.tableName = this.model.prototype.tableName;
        var split_url = this.tableName || this.urlRoot;
        var split_url = _.reject(split_url.split('/'), function (elem) {
            return elem === ''
        });
        var res = {};
        if (split_url.length == 3) {
            res[split_url[0] + '_id'] = parseInt(split_url[1]);
        }
        return res;
    }
    Backbone.Model.prototype.relation_conds = Backbone.Collection.prototype.relation_conds;

    Backbone.Model.prototype.sync = function (method, model, options) {
        return con[method](model, options);
    }

    Backbone.Collection.prototype.sync = function (method, collection, options) {
        return con[method + '_collection'](collection, options);
    }

}).call(this);

module.exports = Backbone;