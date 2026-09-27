package tw.edu.project.kidneydiet;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * 把 App 內拍的照片另存一份到手機相簿。
 *
 * 為什麼自己寫而不是用現成的外掛：試過 @capacitor-community/media，它在 Android 10 以上
 * 是寫進 getExternalMediaDirs()（App 專屬的媒體資料夾），那個位置**解除安裝時會連同照片
 * 一起被刪掉**，而且它要求的 WRITE_EXTERNAL_STORAGE 在 Android 11~12 根本不可能被授予，
 * 權限判斷會一直不通過。這裡直接走 MediaStore：
 *
 * - Android 10 (API 29) 以上：用 RELATIVE_PATH 插入 Pictures/<相簿名>，**完全不需要任何權限**，
 *   而且照片是使用者的，解除安裝 App 也不會被刪。
 * - Android 9 (API 28) 以下：沒有 scoped storage，要寫進公用的 Pictures 目錄必須有
 *   WRITE_EXTERNAL_STORAGE，寫完再通知系統掃描才會出現在相簿裡。
 *
 * 存相簿一律是「盡力而為」：任何一步失敗都只回報 saved=false，不能影響病人記錄這一餐。
 */
@CapacitorPlugin(
    name = "PhotoGallery",
    permissions = {
        @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = PhotoGalleryPlugin.LEGACY_STORAGE)
    }
)
public class PhotoGalleryPlugin extends Plugin {

    static final String LEGACY_STORAGE = "legacyStorage";

    private static final String DEFAULT_ALBUM = "腎臟飲食紀錄";
    private static final String MIME_JPEG = "image/jpeg";

    @PluginMethod
    public void save(PluginCall call) {
        if (call.getString("dataUrl") == null) {
            call.reject("缺少 dataUrl");
            return;
        }
        // Android 9 以下要先拿到寫入權限；10 以上不需要，直接寫。
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                && getPermissionState(LEGACY_STORAGE) != PermissionState.GRANTED) {
            requestPermissionForAlias(LEGACY_STORAGE, call, "onStoragePermission");
            return;
        }
        performSave(call);
    }

    @PermissionCallback
    private void onStoragePermission(PluginCall call) {
        if (getPermissionState(LEGACY_STORAGE) != PermissionState.GRANTED) {
            // 使用者不給權限是他的選擇，不是錯誤：照常回報，讓前端安靜地跳過
            resolveNotSaved(call, "permission-denied");
            return;
        }
        performSave(call);
    }

    private void performSave(PluginCall call) {
        byte[] bytes;
        try {
            String dataUrl = call.getString("dataUrl", "");
            int comma = dataUrl.indexOf(',');
            if (comma < 0) {
                resolveNotSaved(call, "bad-data-url");
                return;
            }
            bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            resolveNotSaved(call, "bad-data-url");
            return;
        }

        String album = call.getString("album", DEFAULT_ALBUM);
        String fileName = call.getString("fileName", "meal-" + System.currentTimeMillis());
        if (!fileName.toLowerCase().endsWith(".jpg")) {
            fileName = fileName + ".jpg";
        }

        try {
            String uri = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? saveViaMediaStore(bytes, album, fileName)
                    : saveToPublicPictures(bytes, album, fileName);
            JSObject result = new JSObject();
            result.put("saved", true);
            result.put("uri", uri);
            call.resolve(result);
        } catch (Exception e) {
            // 相簿存不進去不是嚴重問題（照片已經在 App 的資料庫裡了），別讓它變成錯誤彈窗
            resolveNotSaved(call, e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    /** Android 10+：插入 MediaStore，系統自己決定實體位置，不需要權限 */
    private String saveViaMediaStore(byte[] bytes, String album, String fileName) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
        values.put(MediaStore.Images.Media.MIME_TYPE, MIME_JPEG);
        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + File.separator + album);
        // IS_PENDING：寫完之前別讓相簿看到半張照片
        values.put(MediaStore.Images.Media.IS_PENDING, 1);

        Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IllegalStateException("MediaStore 沒有回傳可寫入的位置");

        try (OutputStream out = resolver.openOutputStream(uri)) {
            if (out == null) throw new IllegalStateException("無法開啟寫入串流");
            out.write(bytes);
        } catch (Exception e) {
            resolver.delete(uri, null, null); // 別留下一筆空的、永遠 pending 的紀錄
            throw e;
        }

        ContentValues done = new ContentValues();
        done.put(MediaStore.Images.Media.IS_PENDING, 0);
        resolver.update(uri, done, null, null);
        return uri.toString();
    }

    /** Android 9 以下：直接寫進公用的 Pictures/<相簿>，再請系統掃描才會出現在相簿 App 裡 */
    private String saveToPublicPictures(byte[] bytes, String album, String fileName) throws Exception {
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), album);
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("無法建立相簿資料夾");

        File file = new File(dir, fileName);
        try (OutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        MediaScannerConnection.scanFile(getContext(), new String[] { file.getAbsolutePath() },
                new String[] { MIME_JPEG }, null);
        return file.getAbsolutePath();
    }

    private void resolveNotSaved(PluginCall call, String reason) {
        JSObject result = new JSObject();
        result.put("saved", false);
        result.put("reason", reason);
        call.resolve(result);
    }
}
