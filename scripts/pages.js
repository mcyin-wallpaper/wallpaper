const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
function run(cmd) {
    try {
        console.log(`执行命令: ${cmd}`);
        execSync(cmd, { stdio: 'inherit', cwd: root });
        console.log(`✅ 命令执行成功: ${cmd}`);
    } catch (error) {
        console.error(`❌ 命令执行失败: ${cmd}`);
        console.error(`错误信息: ${error.message}`);
        process.exit(1);
    }
}
const requiredEnvVars = ['VERSION', 'BACKGROUND_IMAGE', 'DETAIL_JS', 'DOMAIN', 'INDEX_JS', 'ROUTING_JS', 'WEBSTUDIO_LINK', 'VIEWERJS_URL', 'FAVICON', 'F404PAGE'];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.warn(`⚠️ 警告: 环境变量 ${envVar} 未设置`);
    }
}
const defaultVersion = {
    website: { name: '0.0.0', code: 0 },
    android: { name: '0.0.0', code: 0 },
    windows: { name: '0.0.0', code: 0 }
};
let version;
try {
    version = process.env.VERSION ? JSON.parse(process.env.VERSION) : defaultVersion;
} catch (error) {
    console.warn('⚠️ 解析 VERSION 环境变量失败，使用默认版本');
    version = defaultVersion;
}
try {
    fs.writeFileSync(path.join(root, 'public', 'version.json'), JSON.stringify(version, null, 2));
    console.log('✅ 写入 version.json 成功');
} catch (error) {
    console.error('❌ 写入 version.json 失败');
    process.exit(1);
}
const routes = {
    "version": 1,
    "include": [
        "/",
        "/detail",
        "/detail/",
        `/assets/entries/${process.env.ROUTING_JS}`,
        `/assets/entries/${process.env.INDEX_JS}`,
        `/assets/entries/${process.env.DETAIL_JS}`,
        "/api/search",
        "/api/detail",
        "/api/view",
        "/api/update",
        "/api/bing-hp",
        "/wallpaper/search",
        "/wallpaper/detail",
        "/wallpaper/view",
        "/wallpaper/update",
        "/wallpaper/bing-hp"
    ],
    "exclude": []
};
try {
    fs.writeFileSync(path.join(root, 'public', '_routes.json'), JSON.stringify(routes, null, 2));
    console.log('✅ 写入 routes.json 成功');
} catch (error) {
    console.error('❌ 写入 routes.json 失败');
    process.exit(1);
}
const redirects = `/android-apk https://gitcode.com/mcyin-wallpaper/android-client/releases/download/v${version.android.name}/${encodeURIComponent(`Wallpaper时光机 ${version.android.name}.apk`)} 307
/windows-nsis-exe https://gitcode.com/mcyin-wallpaper/windows-client/releases/download/v${version.windows.name}/${encodeURIComponent(`Wallpaper时光机 安装板 ${version.windows.name}.exe`)} 307
/windows-portable-exe https://gitcode.com/mcyin-wallpaper/windows-client/releases/download/v${version.windows.name}/${encodeURIComponent(`Wallpaper时光机 免安装板 ${version.windows.name}.exe`)} 307`;
try {
    fs.writeFileSync(path.join(root, 'public', '_redirects'), redirects);
    console.log('✅ 写入 _redirects 成功');
} catch (error) {
    console.error('❌ 写入 _redirects 失败');
    process.exit(1);
}
try {
    const androidApkHtml = fs.readFileSync(path.join(root, 'public', 'android-apk.html'), 'utf-8');
    fs.writeFileSync(path.join(root, 'public', 'android-apk.html'), androidApkHtml.replace(/{{androidVersion}}/g, version.android.name));
    console.log('✅ 处理 android-apk.html 成功');
} catch (error) {
    console.error('❌ 处理 android-apk.html 失败');
    process.exit(1);
}
try {
    const windowsExeHtml = fs.readFileSync(path.join(root, 'public', 'windows-portable-exe.html'), 'utf-8');
    fs.writeFileSync(path.join(root, 'public', 'windows-portable-exe.html'), windowsExeHtml.replace(/{{windowsVersion}}/g, version.windows.name));
    console.log('✅ 处理 windows-portable-exe.html 成功');
} catch (error) {
    console.error('❌ 处理 windows-portable-exe.html 失败');
    process.exit(1);
}
try {
    const windowsNsisExeHtml = fs.readFileSync(path.join(root, 'public', 'windows-nsis-exe.html'), 'utf-8');
    fs.writeFileSync(path.join(root, 'public', 'windows-nsis-exe.html'), windowsNsisExeHtml.replace(/{{windowsVersion}}/g, version.windows.name));
    console.log('✅ 处理 windows-nsis-exe.html 成功');
} catch (error) {
    console.error('❌ 处理 windows-nsis-exe.html 失败');
    process.exit(1);
}
try {
    const appHtml = fs.readFileSync(path.join(root, 'public', 'app.html'), 'utf-8');
    const backgroundImage = process.env.BACKGROUND_IMAGE ? '/assets/' + process.env.BACKGROUND_IMAGE : '';
    fs.writeFileSync(path.join(root, 'public', 'app.html'), appHtml.replace(/{{backgroundImage}}/g, backgroundImage).replace(/{{domain}}/g, process.env.DOMAIN || 'localhost'));
    console.log('✅ 处理 app.html 成功');
} catch (error) {
    console.error('❌ 处理 app.html 失败');
    process.exit(1);
}
run('npm install viewerjs');
const viewerjsDest = path.join(root, 'public', 'npm', 'viewerjs');
try {
    fs.mkdirSync(viewerjsDest, { recursive: true });
    console.log('✅ 创建 viewerjs 目录成功');
} catch (error) {
    console.error('❌ 创建 viewerjs 目录失败');
    process.exit(1);
}
const viewerjsSrc = path.join(root, 'node_modules', 'viewerjs', 'dist');
try {
    for (const item of fs.readdirSync(viewerjsSrc)) {
        const src = path.join(viewerjsSrc, item);
        const dest = path.join(viewerjsDest, item);
        fs.cpSync(src, dest, { recursive: true });
    }
    console.log('✅ 复制 viewerjs 文件成功');
} catch (error) {
    console.error('❌ 复制 viewerjs 文件失败');
    process.exit(1);
}
if (process.env.WEBSTUDIO_LINK) {
    run('npx webstudio link --link "' + process.env.WEBSTUDIO_LINK + '"');
    console.log('✅ webstudio link 成功');
} else {
    console.warn('⚠️ WEBSTUDIO_LINK 未设置，跳过 webstudio link');
}
run('npx webstudio sync');
const dataJsonPath = path.join(root, '.webstudio', 'data.json');
if (fs.existsSync(dataJsonPath)) {
    try {
        let dataJson = fs.readFileSync(dataJsonPath, 'utf-8');
        if (process.env.VIEWERJS_URL) {
            dataJson = dataJson.replaceAll(process.env.VIEWERJS_URL, '/npm/viewerjs');
        }
        fs.writeFileSync(dataJsonPath, dataJson);
        console.log('✅ 处理 data.json 成功');
    } catch (error) {
        console.warn('⚠️ 处理 data.json 失败');
    }
}
run('npx webstudio build --template ssg');
const faviconSrc = path.join(root, 'public', 'assets', process.env.FAVICON || '');
const faviconDest = path.join(root, 'public', 'favicon.ico');
if (process.env.FAVICON && fs.existsSync(faviconSrc)) {
    try {
        fs.copyFileSync(faviconSrc, faviconDest);
        console.log('✅ 复制 favicon 成功');
    } catch (error) {
        console.warn('⚠️ 复制 favicon 失败');
    }
}
const pagesDir = path.join(root, 'pages');
if (fs.existsSync(pagesDir)) {
    try {
        function walk(dir) {
            for (const item of fs.readdirSync(dir)) {
                const itemPath = path.join(dir, item);
                if (fs.statSync(itemPath).isDirectory()) {
                    walk(itemPath);
                } else if (item === '+data.ts') {
                    let content = fs.readFileSync(itemPath, 'utf-8');
                    content = content.replaceAll('//url', '//' + process.env.DOMAIN || '//url');
                    fs.writeFileSync(itemPath, content);
                }
            }
        }
        walk(pagesDir);
        console.log('✅ 处理 pages 目录成功');
    } catch (error) {
        console.warn('⚠️ 处理 pages 目录失败');
    }
}
run('npm install');
run('npm run build');
const fourOhFourPage = path.join(root, 'dist', 'client', process.env.F404PAGE || '404/index.html');
const fourOhFourPageDest = path.join(root, 'dist', 'client', '404.html');
if (fs.existsSync(fourOhFourPage)) {
    try {
        fs.copyFileSync(fourOhFourPage, fourOhFourPageDest);
        console.log('✅ 复制 404 页面成功');
    } catch (error) {
        console.warn('⚠️ 复制 404 页面失败');
    }
}
run('npm install @supabase/supabase-js');