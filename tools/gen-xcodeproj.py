#!/usr/bin/env python3
"""Gera ios/Croqui.xcodeproj (project.pbxproj + esquema compartilhado).
Rodar de novo só se mudar a lista de arquivos Swift: python3 tools/gen-xcodeproj.py"""
import hashlib, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'ios')
SWIFT = ['CroquiApp.swift', 'CroquiWebView.swift', 'NativeBridge.swift', 'LocalServer.swift']

def oid(name):
    return hashlib.md5(('croqui:' + name).encode()).hexdigest()[:24].upper()

def q(s):
    # Formato "old-style plist": sem aspas só letras, números e . _ / (parênteses e $ são sintaxe).
    if s and all((c.isascii() and c.isalnum()) or c in '._/' for c in s) and not s[0].isdigit():
        return s
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n') + '"'

T = 'Croqui'
ids = {k: oid(k) for k in ['project', 'mainGroup', 'appGroup', 'products', 'target', 'app', 'assets', 'plist',
                           'srcPhase', 'fwPhase', 'resPhase', 'webPhase', 'bcProject', 'bcTarget',
                           'projDebug', 'projRelease', 'tgtDebug', 'tgtRelease', 'bfAssets']}
for f in SWIFT:
    ids['ref:' + f] = oid('ref:' + f)
    ids['bf:' + f] = oid('bf:' + f)

WEB_SCRIPT = '''set -e
# Copia o app web (a mesma versão publicada no GitHub Pages) para dentro do app.
SRC="${SRCROOT}/.."
DST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/www"
mkdir -p "$DST"
rsync -a --delete \\
  --include='index.html' --include='manifest.webmanifest' \\
  --include='css/***' --include='js/***' --include='brand/***' --include='icons/***' \\
  --exclude='*' "$SRC/" "$DST/"
echo "Croqui: app web copiado para $DST"
'''

common = {
    'ALWAYS_SEARCH_USER_PATHS': 'NO', 'CLANG_ENABLE_MODULES': 'YES', 'CLANG_ENABLE_OBJC_ARC': 'YES',
    'COPY_PHASE_STRIP': 'NO', 'ENABLE_STRICT_OBJC_MSGSEND': 'YES', 'GCC_C_LANGUAGE_STANDARD': 'gnu17',
    'GCC_NO_COMMON_BLOCKS': 'YES', 'IPHONEOS_DEPLOYMENT_TARGET': '17.0', 'SDKROOT': 'iphoneos',
    'LOCALIZATION_PREFERS_STRING_CATALOGS': 'YES',
}
proj_debug = {**common, 'DEBUG_INFORMATION_FORMAT': 'dwarf', 'ENABLE_TESTABILITY': 'YES', 'GCC_OPTIMIZATION_LEVEL': '0',
              'ONLY_ACTIVE_ARCH': 'YES', 'SWIFT_ACTIVE_COMPILATION_CONDITIONS': 'DEBUG $(inherited)', 'SWIFT_OPTIMIZATION_LEVEL': '-Onone',
              'GCC_PREPROCESSOR_DEFINITIONS': ['DEBUG=1', '$(inherited)']}
proj_release = {**common, 'DEBUG_INFORMATION_FORMAT': 'dwarf-with-dsym', 'ENABLE_NS_ASSERTIONS': 'NO', 'SWIFT_COMPILATION_MODE': 'wholemodule',
                'VALIDATE_PRODUCT': 'YES'}
tgt = {
    'ASSETCATALOG_COMPILER_APPICON_NAME': 'AppIcon', 'ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME': 'AccentColor',
    'CODE_SIGN_STYLE': 'Automatic', 'CURRENT_PROJECT_VERSION': '1', 'DEVELOPMENT_TEAM': '',
    'ENABLE_PREVIEWS': 'YES', 'ENABLE_USER_SCRIPT_SANDBOXING': 'NO', 'GENERATE_INFOPLIST_FILE': 'YES',
    'INFOPLIST_FILE': 'Croqui/Info.plist', 'INFOPLIST_KEY_CFBundleDisplayName': 'Croqui',
    'INFOPLIST_KEY_LSApplicationCategoryType': 'public.app-category.productivity',
    'INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents': 'YES',
    'INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad': 'UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight',
    'LD_RUNPATH_SEARCH_PATHS': ['$(inherited)', '@executable_path/Frameworks'],
    'MARKETING_VERSION': '2.0', 'PRODUCT_BUNDLE_IDENTIFIER': 'com.pavingcrew.croqui', 'PRODUCT_NAME': '$(TARGET_NAME)',
    'SUPPORTED_PLATFORMS': 'iphoneos iphonesimulator', 'SUPPORTS_MACCATALYST': 'NO', 'SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD': 'NO',
    'SWIFT_EMIT_LOC_STRINGS': 'YES', 'SWIFT_VERSION': '5.0', 'TARGETED_DEVICE_FAMILY': '2',
}

def settings(d, ind):
    out = []
    for k in sorted(d):
        v = d[k]
        if isinstance(v, list):
            out.append(f'{ind}{k} = (\n' + ''.join(f'{ind}\t{q(x)},\n' for x in v) + f'{ind});')
        else:
            out.append(f'{ind}{k} = {q(v)};')
    return '\n'.join(out)

o = []
o.append('// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {\n\t};\n\tobjectVersion = 56;\n\tobjects = {\n')
o.append('/* Begin PBXBuildFile section */\n')
for f in SWIFT:
    o.append(f'\t\t{ids["bf:"+f]} /* {f} in Sources */ = {{isa = PBXBuildFile; fileRef = {ids["ref:"+f]} /* {f} */; }};\n')
o.append(f'\t\t{ids["bfAssets"]} /* Assets.xcassets in Resources */ = {{isa = PBXBuildFile; fileRef = {ids["assets"]} /* Assets.xcassets */; }};\n')
o.append('/* End PBXBuildFile section */\n\n/* Begin PBXFileReference section */\n')
o.append(f'\t\t{ids["app"]} /* {T}.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = {T}.app; sourceTree = BUILT_PRODUCTS_DIR; }};\n')
for f in SWIFT:
    o.append(f'\t\t{ids["ref:"+f]} /* {f} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {f}; sourceTree = "<group>"; }};\n')
o.append(f'\t\t{ids["assets"]} /* Assets.xcassets */ = {{isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>"; }};\n')
o.append(f'\t\t{ids["plist"]} /* Info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; }};\n')
o.append('/* End PBXFileReference section */\n\n/* Begin PBXFrameworksBuildPhase section */\n')
o.append(f'\t\t{ids["fwPhase"]} /* Frameworks */ = {{\n\t\t\tisa = PBXFrameworksBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t}};\n')
o.append('/* End PBXFrameworksBuildPhase section */\n\n/* Begin PBXGroup section */\n')
o.append(f'\t\t{ids["mainGroup"]} = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\t{ids["appGroup"]} /* {T} */,\n\t\t\t\t{ids["products"]} /* Products */,\n\t\t\t);\n\t\t\tsourceTree = "<group>";\n\t\t}};\n')
o.append(f'\t\t{ids["products"]} /* Products */ = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\t{ids["app"]} /* {T}.app */,\n\t\t\t);\n\t\t\tname = Products;\n\t\t\tsourceTree = "<group>";\n\t\t}};\n')
kids = ''.join(f'\t\t\t\t{ids["ref:"+f]} /* {f} */,\n' for f in SWIFT)
o.append(f'\t\t{ids["appGroup"]} /* {T} */ = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n{kids}\t\t\t\t{ids["assets"]} /* Assets.xcassets */,\n\t\t\t\t{ids["plist"]} /* Info.plist */,\n\t\t\t);\n\t\t\tpath = {T};\n\t\t\tsourceTree = "<group>";\n\t\t}};\n')
o.append('/* End PBXGroup section */\n\n/* Begin PBXNativeTarget section */\n')
o.append(f'''\t\t{ids["target"]} /* {T} */ = {{
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = {ids["bcTarget"]} /* Build configuration list for PBXNativeTarget "{T}" */;
\t\t\tbuildPhases = (
\t\t\t\t{ids["srcPhase"]} /* Sources */,
\t\t\t\t{ids["fwPhase"]} /* Frameworks */,
\t\t\t\t{ids["resPhase"]} /* Resources */,
\t\t\t\t{ids["webPhase"]} /* Copiar app web */,
\t\t\t);
\t\t\tbuildRules = (
\t\t\t);
\t\t\tdependencies = (
\t\t\t);
\t\t\tname = {T};
\t\t\tproductName = {T};
\t\t\tproductReference = {ids["app"]} /* {T}.app */;
\t\t\tproductType = "com.apple.product-type.application";
\t\t}};
''')
o.append('/* End PBXNativeTarget section */\n\n/* Begin PBXProject section */\n')
o.append(f'''\t\t{ids["project"]} /* Project object */ = {{
\t\t\tisa = PBXProject;
\t\t\tattributes = {{
\t\t\t\tBuildIndependentTargetsInParallel = 1;
\t\t\t\tLastSwiftUpdateCheck = 1600;
\t\t\t\tLastUpgradeCheck = 1600;
\t\t\t\tTargetAttributes = {{
\t\t\t\t\t{ids["target"]} = {{
\t\t\t\t\t\tCreatedOnToolsVersion = 16.0;
\t\t\t\t\t}};
\t\t\t\t}};
\t\t\t}};
\t\t\tbuildConfigurationList = {ids["bcProject"]} /* Build configuration list for PBXProject "{T}" */;
\t\t\tcompatibilityVersion = "Xcode 14.0";
\t\t\tdevelopmentRegion = "pt-BR";
\t\t\thasScannedForEncodings = 0;
\t\t\tknownRegions = (
\t\t\t\ten,
\t\t\t\tBase,
\t\t\t\t"pt-BR",
\t\t\t);
\t\t\tmainGroup = {ids["mainGroup"]};
\t\t\tproductRefGroup = {ids["products"]} /* Products */;
\t\t\tprojectDirPath = "";
\t\t\tprojectRoot = "";
\t\t\ttargets = (
\t\t\t\t{ids["target"]} /* {T} */,
\t\t\t);
\t\t}};
''')
o.append('/* End PBXProject section */\n\n/* Begin PBXResourcesBuildPhase section */\n')
o.append(f'\t\t{ids["resPhase"]} /* Resources */ = {{\n\t\t\tisa = PBXResourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t\t{ids["bfAssets"]} /* Assets.xcassets in Resources */,\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t}};\n')
o.append('/* End PBXResourcesBuildPhase section */\n\n/* Begin PBXShellScriptBuildPhase section */\n')
o.append(f'''\t\t{ids["webPhase"]} /* Copiar app web */ = {{
\t\t\tisa = PBXShellScriptBuildPhase;
\t\t\talwaysOutOfDate = 1;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
\t\t\t);
\t\t\tinputFileListPaths = (
\t\t\t);
\t\t\tinputPaths = (
\t\t\t);
\t\t\tname = "Copiar app web";
\t\t\toutputFileListPaths = (
\t\t\t);
\t\t\toutputPaths = (
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t\tshellPath = /bin/sh;
\t\t\tshellScript = {q(WEB_SCRIPT)};
\t\t\tshowEnvVarsInLog = 0;
\t\t}};
''')
o.append('/* End PBXShellScriptBuildPhase section */\n\n/* Begin PBXSourcesBuildPhase section */\n')
srcs = ''.join(f'\t\t\t\t{ids["bf:"+f]} /* {f} in Sources */,\n' for f in SWIFT)
o.append(f'\t\t{ids["srcPhase"]} /* Sources */ = {{\n\t\t\tisa = PBXSourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n{srcs}\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t}};\n')
o.append('/* End PBXSourcesBuildPhase section */\n\n/* Begin XCBuildConfiguration section */\n')
for key, name, d in [('projDebug', 'Debug', proj_debug), ('projRelease', 'Release', proj_release), ('tgtDebug', 'Debug', tgt), ('tgtRelease', 'Release', tgt)]:
    o.append(f'\t\t{ids[key]} /* {name} */ = {{\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {{\n{settings(d, chr(9)*4)}\n\t\t\t}};\n\t\t\tname = {name};\n\t\t}};\n')
o.append('/* End XCBuildConfiguration section */\n\n/* Begin XCConfigurationList section */\n')
for key, a, b, label in [('bcProject', 'projDebug', 'projRelease', f'PBXProject "{T}"'), ('bcTarget', 'tgtDebug', 'tgtRelease', f'PBXNativeTarget "{T}"')]:
    o.append(f'\t\t{ids[key]} /* Build configuration list for {label} */ = {{\n\t\t\tisa = XCConfigurationList;\n\t\t\tbuildConfigurations = (\n\t\t\t\t{ids[a]} /* Debug */,\n\t\t\t\t{ids[b]} /* Release */,\n\t\t\t);\n\t\t\tdefaultConfigurationIsVisible = 0;\n\t\t\tdefaultConfigurationName = Release;\n\t\t}};\n')
o.append('/* End XCConfigurationList section */\n\t};\n\trootObject = ' + ids['project'] + ' /* Project object */;\n}\n')

proj = os.path.join(ROOT, f'{T}.xcodeproj')
os.makedirs(os.path.join(proj, 'project.xcworkspace'), exist_ok=True)
os.makedirs(os.path.join(proj, 'xcshareddata', 'xcschemes'), exist_ok=True)
open(os.path.join(proj, 'project.pbxproj'), 'w').write(''.join(o))
open(os.path.join(proj, 'project.xcworkspace', 'contents.xcworkspacedata'), 'w').write(
    '<?xml version="1.0" encoding="UTF-8"?>\n<Workspace\n   version = "1.0">\n   <FileRef\n      location = "self:">\n   </FileRef>\n</Workspace>\n')
ref = f'''<BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "{ids["target"]}"
               BuildableName = "{T}.app"
               BlueprintName = "{T}"
               ReferencedContainer = "container:{T}.xcodeproj">
            </BuildableReference>'''
open(os.path.join(proj, 'xcshareddata', 'xcschemes', f'{T}.xcscheme'), 'w').write(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme
   LastUpgradeVersion = "1600"
   version = "1.7">
   <BuildAction
      parallelizeBuildables = "YES"
      buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry
            buildForTesting = "YES"
            buildForRunning = "YES"
            buildForProfiling = "YES"
            buildForArchiving = "YES"
            buildForAnalyzing = "YES">
            {ref}
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      shouldUseLaunchSchemeArgsEnv = "YES">
   </TestAction>
   <LaunchAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      launchStyle = "0"
      useCustomWorkingDirectory = "NO"
      ignoresPersistentStateOnLaunch = "NO"
      debugDocumentVersioning = "YES"
      debugServiceExtension = "internal"
      allowLocationSimulation = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         {ref}
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction
      buildConfiguration = "Release"
      shouldUseLaunchSchemeArgsEnv = "YES"
      savedToolIdentifier = ""
      useCustomWorkingDirectory = "NO"
      debugDocumentVersioning = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         {ref}
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction
      buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction
      buildConfiguration = "Release"
      revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
''')
print('ok', proj)
