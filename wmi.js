function forEach(objectset, yield){
    for(var e = new Enumerator(objectset); !e.atEnd(); e.moveNext()){
        yield(e.item());
    }
}

$callbacks = {
  OnCompleted: {},
  OnObjectPut: {},
  OnObjectReady: {},
  OnProgress: {}
};

$sink = WScript.CreateObject("WbemScripting.SWbemSink", "SINK_");

function SINK_OnCompleted(iHResult, objWbemErrorObject, objWbemAsyncContext){
    var key = objWbemAsyncContext.Item("key");
    $callbacks["OnCompleted"][key](iHResult, objWbemErrorObject, objWbemAsyncContext);
}

function SINK_OnObjectPut(objWbemObjectPath, objWbemAsyncContext){
    var key = objWbemAsyncContext.Item("key");
    $callbacks["OnObjectPut"][key](objWbemObjectPath, objWbemAsyncContext);
}

function SINK_OnObjectReady(objWbemObject, objWbemAsyncContext){
    var key = objWbemAsyncContext.Item("key");
    $callbacks["OnObjectReady"][key](objWbemObject, objWbemAsyncContext);
}

function SINK_OnProgress(iUpperBound, iCurrent, strMessage, objWbemAsyncContext){
    var key = objWbemAsyncContext.Item("key");
    $callbacks["OnProgress"][key](iUpperBound, iCurrent, strMessage, objWbemAsyncContext);
}

function WMIClass(classname){
    this.locator = WScript.CreateObject("WbemScripting.SWbemLocator");
    this.service = this.locator.ConnectServer();
    this.first_time = true;
    this.classname = classname;
    this.wmiclass = this.service.Get(classname);
    var self = this;
    forEach(this.wmiclass.Methods_, function(method){
        var method_name = method.Name;
        if(method.InParameters){
            self[method_name] = WMIClass_method_with_arg(method_name);
        }
        else{
            self[method_name] = WMIClass_method_with_no_arg(method_name);
        }
    });
}

function WMIClass_method_with_arg(method_name){
    return function(){
        var keys = [];
        var in_params = this.wmiclass.Methods_.Item(method_name).InParameters;
        forEach(in_params.Properties_, function(param){
            keys[keys.length] = param.Name;
        });
        var in_params2 = in_params.SpawnInstance_();
        for(var i = 0; i < keys.length; i++){
            in_params2.Properties_.Item(keys[i]).Value = arguments[i];
        }
        var out_params = this.wmiclass.ExecMethod_(method_name, in_params2);

        return WMIClass_convert_out_params(out_params);
    }
}

function WMIClass_method_with_no_arg(method_name){
    return function(){
        var out_params = this.wmiclass.ExecMethod_(method_name);
        return WMIClass_convert_out_params(out_params);
    }
}

function WMIClass_convert_out_params(out_params){
    try{
        var outs = [];
        forEach(out_params.Properties_, function(out_param){
          if(out_param.Name == "ReturnValue"){
            if(out_param.Value != 0){
              throw("invalid Return Value :" + out_param.Value);
            }
          }
          else{
            outs[outs.length] = out_param.Value;
          }
        });
        switch(outs.length){
        case 0:
            return;
        case 1:
            return outs[0];
        default:
            return outs;
        }
    }
    catch(e){
        WScript.Echo(e);
    }
}

function WMIClass.prototype.wrap(wmiobject){
    if(this.first_time){
        var options = WMIClass.inspect(wmiobject);
        var filename = WMIClass.write_wsc_file(options);
        this.wmiobject_wrapped = GetObject("script:"+filename);
        this.wmiobject_wrapped.wmiobject = wmiobject;
    }
    else{
        this.wmiobject_wrapped.wmiobject = wmiobject;
    }
    return this.wmiobject_wrapped;
}

function WMIClass.write_wsc_file(options){
    var class_name = options["Class"];
    var filename = class_name + ".wsc";
    var fso = WScript.CreateObject("Scripting.FileSystemObject");

    var thisfilename = WScript.ScriptFullName;
    var thisfile = fso.GetFile(thisfilename);
    var wscfilename = fso.GetParentFolderName(thisfilename) +
        "\\wmi\\" + class_name + "\.wsc";
    var file_not_exist = true, wsc_file_is_older = false;
    if(fso.FileExists(wscfilename)){
        file_not_exist = false;
        var wscfile = fso.GetFile(wscfilename);
        if(thisfile.DateLastModified >
                wscfile.DateLastModified){
            wsc_file_is_older = true;
        }
    }
    if(file_not_exist || wsc_file_is_older){
        var script = WMIClass.compose_wsc_script(options);
        var istream = fso.CreateTextFile(wscfilename);
        istream.Write(script);
        istream.Close();
        istream = null;
    }
    fso = null;
    return wscfilename;
}

function WMIClass.compose_wsc_script(options){
    var functions_str = "";

    var properties = options["properties"];
    var properties_str = "";
    for(i = 0; i < properties.length; i++){
        properties_str += "  <property name=\"" + properties[i] + "\">\n";
        properties_str += "    <get /><put />\n";
        properties_str += "  </property>\n";
    }
    var property_funcs = options["property_funcs"];
    for(i = 0; i < property_funcs.length; i++){
        functions_str += property_funcs[i];
    }

    var methods_str= "";
    var methods = options["methods"];
    for(var i = 0; i < methods.length; i++){
       var method = methods[i];
       methods_str += "  <method name=\"" + method.name + "\">\n";
       var params = method.params;
       for(var j = 0; j < params.length; j++){
         methods_str += "    <parameter name=\"" + params[j] + "\" />\n";
       }
       methods_str += "  </method>\n";
    }
    var method_funcs = options["method_funcs"];
    for(i = 0; i < method_funcs.length; i++){
        functions_str += method_funcs[i];
    }

    var fso = WScript.CreateObject("Scripting.FileSystemObject");
    var template_filename =
        fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName),
                "wmiobject_template.js");
    var file = fso.OpenTextFile(template_filename);
    var template = file.ReadAll();
    file = null;
    fso = null;
    template = template.replace("#{properties_str}", properties_str);
    template = template.replace("#{methods_str}", methods_str);
    template = template.replace("#{functions_str}", functions_str);
    return template;
}

function WMIClass.inspect(wmiclass){
    var properties = [];
    var property_funcs = [];
    var methods   = [];
    var method_funcs   = [];
    forEach(wmiclass.Properties_, function(property){
        properties[properties.length] = property.Name;
        var func =
    function get_$NAME(){
        return wmiobject_.Properties_.Item("$NAME").Value;
    }, put_func =
    function put_$NAME(value){
        wmiobject_.Properties.Item("$NAME").Value = value;
    };
        var func_str = "    " +
            func.toString().replace(/\$NAME/g, property.Name) + "\n";
        if(property.IsArray){
            func_str = func_str.replace("Value;", "Value.toArray();");
        }
        property_funcs[property_funcs.length] = func_str;
        property_funcs[property_funcs.length] = "    " +
            put_func.toString().replace(/\$NAME/g, property.Name) + "\n";

    });

    var func_str = "";
    CimTypes = {
        2: "int16_t", 3: "int32_t", 4: "float", 5:"double",
        8: "String", 11: "boolean", 13: "Object", 16:"int8_t",
        17: "uint8_t", 18: "uint16_t", 19: "uint32_t", 20:"int64_t",
        21:"uint64_t", 101: "WMIDatetime", 102: "Reference", 103: "Char_16bit"
    };


    forEach(wmiclass.Methods_, function(method){
        var method_name = method.Name;
        var func, in_params;
        var comments = ["//** METHOD NAME: " + method_name];
        forEach(method.OutParameters.Properties_, function(out_param){
            if(out_param.Name == "ReturnValue") return;
            comments[comments.length] = 
            "//* (out) " + out_param.Name +
            ( out_param.IsArray ? "[]" : "") +
            " AS " + CimTypes[out_param.CIMType];
        });
        if(method.InParameters){
            in_params = [];
            forEach(method.InParameters.Properties_, function(in_param){
                in_params[in_params.length] = in_param.Name;
                comments[comments.length] = 
                "//*  (in) " + in_param.Name +
                ( in_param.IsArray ? "[]" : "") +
                " AS " + CimTypes[in_param.CIMType];
            });
            methods[methods.length] = {
                name: method_name,
                params: in_params
            };
            func =
    function $NAME($ARGUMENTS){
        var in_params = wmiobject_.Methods_.Item("$NAME").InParameters.SpawnInstance_();
$REPLACEMENT
        var out_params = wmiobject_.ExecMethod_("$NAME", in_params);
        return WMIClass_convert_out_params(out_params);
    };
            var replacement = "";
            for(var i = 0; i < in_params.length ; i++){
                var arg = in_params[i];
                replacement += "        if(" + arg + " !== undefined ){\n" +
                    "            in_params.Properties_.Item(\"" +
                    arg + "\").Value = " + arg + ";\n" + 
                    "        }\n";
            }
            func_str += comments.join("\n") + "\n" +
                "    " + func.toString().replace(/\$NAME/g, method_name).
                replace("$ARGUMENTS", in_params.join(", ")).
                replace("$REPLACEMENT", replacement) + "\n";
        }
        else{
            methods[methods.length] = {
                name: method_name,
                params: []
            };
            func = WMIClass_method_with_no_arg(method_name);
            func_str += "    " +
                func.toString().replace("method_name", "\"" + method_name + "\"").
                replace("function()", "function "+method_name+"()").
                replace("this.wmiclass.", "wmiobject_.") + "\n";
        }
    });
    method_funcs[method_funcs.length] = func_str;

    var options = {};
    options["Class"] = wmiclass.Path_.Class;
    options["methods"] = methods;
    options["properties"] = properties;
    options["method_funcs"] = method_funcs;
    options["property_funcs"] = property_funcs;
    return options;
}


function WMIClass.prototype.InstancesOf(callback){
    var contextvalue = this.classname + "-InstancesOf";
    var self = this;
    var func = function(objWbemObject, objWbemAsyncContext){
        var instance = self.wrap(objWbemObject);
        return callback(instance, objWbemAsyncContext);
    };
    $callbacks["OnObjectReady"][contextvalue] = func;
    $callbacks["OnCompleted"][contextvalue] = function(){
        $callbacks["OnObjectReady"][contextvalue] = null;
        $callbacks["OnCompleted"][contextvalue] = null;
    };
    var hash = WScript.CreateObject("WbemScripting.SWbemNamedValueSet");
    hash.add("key", contextvalue);
    this.service.InstancesOfAsync($sink, this.classname, null, null, hash);
}

function WMIClass.prototype.ExecQuery(wql, callback){
    var contextvalue = this.classname + "-ExecQuery";
    var self = this;
    var func = function(objWbemObject, objWbemAsyncContext){
        var instance = self.wrap(objWbemObject);
        return callback(instance, objWbemAsyncContext);
    };
    $callbacks["OnObjectReady"][contextvalue] = func;
    $callbacks["OnCompleted"][contextvalue] = function(){
        $callbacks["OnObjectReady"][contextvalue] = null;
        $callbacks["OnCompleted"][contextvalue] = null;
    };
    var hash = WScript.CreateObject("WbemScripting.SWbemNamedValueSet");
    hash.add("key", contextvalue);
    this.service.ExecQueryAsync($sink, wql, "WQL", 0, null, hash);
}
