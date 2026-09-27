package tw.edu.project.kidneydiet;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 這個專案自己寫的外掛要手動註冊（npm 安裝的外掛才會自動註冊），
        // 而且一定要在 super.onCreate 之前，否則 WebView 已經載入、註冊就太晚了。
        registerPlugin(PhotoGalleryPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
