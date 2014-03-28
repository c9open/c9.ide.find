define(function(require, exports, module) {
    "use strict";
    
    main.consumes = [
        "Plugin", "preferences", "ext", "fs", "proc", "settings", "vfs"
    ];
    main.provides = ["finder"];
    return main;

    function main(options, imports, register) {
        var Plugin   = imports.Plugin;
        var settings = imports.settings;
        var prefs    = imports.preferences;
        var proc     = imports.proc;
        var vfs      = imports.vfs;
        var fs       = imports.fs;
        
        var join     = require("path").join;
        var dirname  = require("path").dirname;
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        // var emit   = plugin.getEmitter();
        
        var USEHTTP     = options.useHttp;
        var IGNORE      = options.ignore;
        var MAIN_IGNORE = join(options.installPath, "/.nakignore");
        var TEMPLATE    = require("text!./nakignore-template")
            + "\n" + (options.ignore || "");
        var NAK         = options.nak || "~/.c9/node_modules/nak/bin/nak";
        var NODE        = options.node;
        
        if (NODE && Array.isArray(NODE)) 
            NODE = NODE[0];

        var loaded = false;
        function load(callback){
            if (loaded) return;
            loaded = true;
            
            prefs.add({
               "General" : {
                   "Find in Files" : {
                       position : 30,
                       "Ignore these files" : {
                           name      : "txtPref",
                           type      : "textarea",
                           width     : 150,
                           height    : 130,
                           rowheight : 155,
                           position  : 1000
                       },
                       "Maximum number of files to search (in 1000)" : {
                            type : "spinner",
                            path : "user/find.nak/@searchLimit",
                            min  : "20",
                            max  : "500",
                            position : 10500
                       }
                   }
               }
            }, plugin);
            
            settings.on("read", function(){
                if (!settings.getBool("state/nak/@installed")) {
                    fs.writeFile(MAIN_IGNORE, TEMPLATE, function(){
                        settings.set("state/nak/@installed", true);
                    });
                }
                settings.setDefaults("user/find.nak",[
                    ["searchLimit", 100]
                ]);
            });
            
            plugin.getElement("txtPref", function(txtPref){
                var ta = txtPref.lastChild;
                
                ta.on("afterchange", function(e){
                    fs.writeFile(MAIN_IGNORE, e.value, function(){});
                });
                
                fs.readFile(MAIN_IGNORE, function(err, data){
                    if (err)
                        data = TEMPLATE;
                    
                    ta.setValue(data);
                    
                    return false;
                });
            }, plugin);
        }
        
        /***** Methods *****/
        
        function addLimit(args, options) {
            args.limit = options.limit || (
                settings.getNumber("user/find.nak/@searchLimit") * 1000);
        }
        
        function assembleFilelistCommand(options) {
            var args = {list: true};
            
            args.pathToNakignore = join(options.base, MAIN_IGNORE);
            
            if (options.hidden)
                args.hidden = true;
            
            if (options.startPaths)
                args.startPaths = options.startPaths;
                
            args.path = options.path;
            args.follow = true;
            addLimit(args, options);
            
            if (options.useHttp)
                return args;
    
            return ["--json", JSON.stringify(args)];
        }
    
        function assembleSearchCommand(options) {
            var args = {};
    
            args.pathToNakignore = join(options.base, MAIN_IGNORE);
    
            if (!options.casesensitive)
                args.ignoreCase = true;
    
            if (options.wholeword)
                args.wordRegexp = true;
    
            if (options.hidden)
                args.hidden = true;
                
            if (!options.regexp)
                args.literal = true;
            
            var includes = [], excludes = [];
    
            if (options.pattern) {
                // strip whitespace, grab out exclusions
                options.pattern.split(",").forEach(function (p) {
                    // strip whitespace
                    p = p.replace(/\s*/g, "");
    
                    if (/^\-/.test(p))
                        excludes.push(p.substring(1));
                    else
                        includes.push(p);
                });
            }
            
            if (IGNORE)
                excludes.push(IGNORE);

            // wildcard handling will be done in nak
            if (includes.length)
                args.pathInclude = includes.join(", ");

            if (excludes.length)
                args.ignore = excludes.join(", ");
    
            args.query = options.query;
    
            if (options.replaceAll)
                args.replacement = options.replacement;
            
            if (options.startPaths)
                args.startPaths = options.startPaths;
            
            args.path = options.path;
            args.follow = true;
            addLimit(args, options);
            
            return ["--json", JSON.stringify(args)];
        }
        
        function list(options, callback){
            options.uri  = options.path || "";
            options.path = join((options.base || ""), (options.path || ""));
            options.useHttp = USEHTTP && options.buffer;
            
            if (!options.path)
                return callback(new Error("Invalid Path"));
            var args = assembleFilelistCommand(options);
            if (!args)
                return callback(new Error("Invalid Arguments"));
            
            if (options.useHttp) {
                delete args.list;
                delete args.follow;
                
                vfs.rest("~/.c9/file.listing", {
                    method  : "GET",
                    query   : args,
                    timeout : 120000
                }, function(err, data, res){
                    callback(err, data);
                });
            }
            else {
                execute(args, function(err, stdout, stderr, process){
                    callback(err, stdout, stderr, process);
                });
            }
        }
        
        function find(options, callback){
            options.uri  = options.path || "";
            options.path = join((options.base || ""), (options.path || ""));
            
            if (!options.path)
                return callback(new Error("Invalid Path"));
            
            var args = assembleSearchCommand(options);
            if (!args)
                return callback(new Error("Invalid Arguments"));
                
            // if (this.activeProcess)
            //     this.activeProcess.kill("SIGKILL");
                
            execute(args, function(err, stdout, stderr, process){
                callback(err, stdout, stderr, process);
            });
        }
        
        function execute(args, callback){
            if (NODE) args.unshift(NAK);
            proc.spawn(NODE || NAK, {
                args: args
            }, function(err, process){
                if (err)
                    return callback(err);
                
                callback(null, process.stdout, process.stderr, process);
            });
        }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function(){
            load();
        });
        
        plugin.on("unload", function(){
            loaded = false;
        });
        
        /***** Register and define API *****/
        
        /**
         * Finder implementation using [nak](https://github.com/gjtorikian/nak). 
         * This plugin is used solely by the {@link find} plugin. If you want to
         * create your own search implementation, re-implement this plugin.
         * @singleton
         **/
        plugin.freezePublicAPI({
            /**
             * Retrieves a list of files and lines that match a string or pattern
             * @param {Object}   options 
             * @param {String}   options.path             the path to search in (displayed in the results)
             * @param {String}   [options.base]           the base path to search in (is not displayed in the results)
             * @param {String}   [options.query]          the text or regexp to match the file contents with
             * @param {Boolean}  [options.casesensitive]  whether to match on case or not. Default is false;
             * @param {Boolean}  [options.wholeword]      whether to match the `query` as a whole word.
             * @param {String}   [options.hidden]         include files starting with a dott. Defaults to false.
             * @param {String}   [options.regexp]         whether the `query` is a regular expression.
             * @param {String}   [options.pattern]        specify what files/dirs to include
             *      and exclude. Prefix the words with minus '-' to exclude.
             * @param {Boolean}  [options.replaceAll]     whether to replace the found matches
             * @param {String}   [options.replacement]    the string to replace the found matches with
             * @param {Function} callback                 called when the results come in
             * @param {Error}    callback.err     
             * @param {proc.Stream}   callback.results 
             */
            find : find,
            
            /**
             * Retrieves a list of files under a path
             * @param {Object}   options
             * @param {String}   [options.path]     the path to search in (displayed in the results)
             * @param {String}   [options.base]     the base path to search in (is not displayed in the results)
             * @param {Boolean}  [options.hidden]   include files starting with a dott. Defaults to false.
             * @param {Number}   [options.maxdepth] maximum amount of parents a file can have.
             * @param {Function} callback called when the results come in
             * @param {Error}    callback.err     
             * @param {proc.Stream}   callback.results 
             */
            list : list
        });
        
        register(null, {
            finder: plugin
        });
    }
});
