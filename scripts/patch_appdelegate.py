# 在 AppDelegate 啟動時讀出側載簽署的到期時間，寫到 Library/provision-expiry.txt，讓 App 畫面顯示「剩幾天」
import sys
p = 'ios/App/App/AppDelegate.swift'
s = open(p, encoding='utf-8').read()
anchor = '        // Override point for customization after application launch.\n'
if anchor not in s:
    sys.exit('找不到 AppDelegate 插入點，請回報')
code = '''        // 讀取簽署到期時間（embedded.mobileprovision）
        if let path = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision"),
           let raw = try? Data(contentsOf: URL(fileURLWithPath: path)),
           let text = String(data: raw, encoding: .isoLatin1),
           let start = text.range(of: "<?xml"),
           let end = text.range(of: "</plist>") {
            let xml = String(text[start.lowerBound..<end.upperBound])
            if let data = xml.data(using: .isoLatin1),
               let plist = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: Any],
               let exp = plist["ExpirationDate"] as? Date,
               let lib = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first {
                let iso = ISO8601DateFormatter().string(from: exp)
                try? iso.write(to: lib.appendingPathComponent("provision-expiry.txt"), atomically: true, encoding: .utf8)
            }
        }
'''
s = s.replace(anchor, anchor + code, 1)
open(p, 'w', encoding='utf-8').write(s)
print('AppDelegate 已加入到期時間讀取')
