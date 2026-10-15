// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.3"),
        .package(name: "CapacitorApp", path: "../../../../../node_modules/.pnpm/@capacitor+app@8.1.2_@capacitor+core@8.5.3/node_modules/@capacitor/app"),
        .package(name: "CapacitorStatusBar", path: "../../../../../node_modules/.pnpm/@capacitor+status-bar@8.0.4_@capacitor+core@8.5.3/node_modules/@capacitor/status-bar"),
        .package(name: "CapgoCapacitorShareTarget", path: "../../../../../node_modules/.pnpm/@capgo+capacitor-share-target@8.0.61_@capacitor+core@8.5.3/node_modules/@capgo/capacitor-share-target")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorStatusBar", package: "CapacitorStatusBar"),
                .product(name: "CapgoCapacitorShareTarget", package: "CapgoCapacitorShareTarget")
            ]
        )
    ]
)
