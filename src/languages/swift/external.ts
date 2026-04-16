/**
 * Swift external-framework detection.
 *
 * System frameworks (Foundation, SwiftUI, UIKit, etc.) are matched against
 * a built-in set. Package.swift deps are parsed from `.package(...)` calls.
 */

import { join } from 'path';
import { cachedExists } from '../../resolver/fs-cache';
import { getOrLoadDeps, type LangDeps, safeRead } from '../external-shared';

const SWIFT_FRAMEWORKS = new Set([
    'Foundation',
    'Swift',
    'SwiftUI',
    'Combine',
    'Observation',
    'UIKit',
    'AppKit',
    'WatchKit',
    'WidgetKit',
    'CoreData',
    'SwiftData',
    'CloudKit',
    'Network',
    'WebKit',
    'AVFoundation',
    'AVKit',
    'CoreGraphics',
    'CoreImage',
    'CoreAnimation',
    'QuartzCore',
    'Metal',
    'MetalKit',
    'SpriteKit',
    'SceneKit',
    'RealityKit',
    'ARKit',
    'Vision',
    'CoreML',
    'CreateML',
    'NaturalLanguage',
    'CoreLocation',
    'MapKit',
    'CoreBluetooth',
    'CoreMotion',
    'CoreTelephony',
    'CoreNFC',
    'LocalAuthentication',
    'Security',
    'CryptoKit',
    'UserNotifications',
    'BackgroundTasks',
    'Accessibility',
    'StoreKit',
    'GameKit',
    'HealthKit',
    'HomeKit',
    'EventKit',
    'Contacts',
    'ContactsUI',
    'MessageUI',
    'Messages',
    'MultipeerConnectivity',
    'Photos',
    'PhotosUI',
    'XCTest',
    'Testing',
    'os',
    'Darwin',
    'Dispatch',
    'ObjectiveC',
    'PlaygroundSupport',
    'PackageDescription',
]);

function loadDeps(repoRoot: string): LangDeps {
    const pkgs = new Set<string>();
    const packageSwift = safeRead(join(repoRoot, 'Package.swift'));
    if (packageSwift) {
        // Matches: .package(url: "https://github.com/org/Name.git", ...) or .package(name: "Name", ...)
        const urlRegex = /\.package\(\s*(?:name:\s*"([^"]+)",\s*)?url:\s*"([^"]+)"/g;
        let m: RegExpExecArray | null = urlRegex.exec(packageSwift);
        while (m !== null) {
            if (m[1]) {
                pkgs.add(m[1]);
            } else if (m[2]) {
                const urlParts = m[2].replace(/\.git$/, '').split('/');
                const name = urlParts[urlParts.length - 1];
                if (name) {
                    pkgs.add(name);
                }
            }
            m = urlRegex.exec(packageSwift);
        }
    }
    return { packages: pkgs };
}

export function detect(modulePath: string, repoRoot: string): string | null {
    if (SWIFT_FRAMEWORKS.has(modulePath)) {
        return modulePath;
    }

    if (!cachedExists(join(repoRoot, 'Package.swift'))) {
        return null;
    }

    const deps = getOrLoadDeps('swift', repoRoot, () => loadDeps(repoRoot));
    if (deps.packages.has(modulePath)) {
        return modulePath;
    }
    return null;
}
