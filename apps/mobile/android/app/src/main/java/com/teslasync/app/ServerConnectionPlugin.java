package com.teslasync.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ServerConnection")
public class ServerConnectionPlugin extends Plugin {
    @PluginMethod
    public void save(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("A server address is required");
            return;
        }
        try {
            JSObject connection = new JSObject();
            connection.put("url", url);
            connection.put("token", call.getString("token"));
            new ServerConnectionStore(getContext()).save(connection.toString());
            call.resolve();
        } catch (Exception exception) {
            call.reject("Could not save native connection");
        }
    }

    @PluginMethod
    public void load(PluginCall call) {
        try {
            String connection = new ServerConnectionStore(getContext()).load();
            call.resolve(connection == null ? new JSObject() : new JSObject(connection));
        } catch (Exception exception) {
            call.reject("Could not restore native connection");
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        try {
            new ServerConnectionStore(getContext()).clear();
            call.resolve();
        } catch (Exception exception) {
            call.reject("Could not clear native connection");
        }
    }
}
