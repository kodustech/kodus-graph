/**
 * Swift import resolver.
 *
 * Swift imports are module-level: `import Foundation`, `import UIKit`.
 * Framework/system imports are excluded (return null).
 * Local module imports attempt to find matching source files in the project.
 */

import { join, resolve as resolvePath } from 'path';
import { cachedExists, cachedReaddir } from '../fs-cache';

// ---------------------------------------------------------------------------
// Well-known Apple/Swift frameworks and system modules
// ---------------------------------------------------------------------------

const SWIFT_FRAMEWORKS = new Set([
    // Core Swift & Foundation
    'Foundation',
    'Swift',
    'SwiftUI',
    'Combine',
    'Observation',

    // UIKit & AppKit
    'UIKit',
    'AppKit',
    'WatchKit',
    'WidgetKit',

    // Data & Storage
    'CoreData',
    'SwiftData',
    'CloudKit',
    'RealmSwift',

    // Networking & Web
    'Network',
    'WebKit',

    // Media & Graphics
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

    // Location & Maps
    'CoreLocation',
    'MapKit',

    // System & Hardware
    'CoreBluetooth',
    'CoreMotion',
    'CoreTelephony',
    'CoreNFC',
    'LocalAuthentication',
    'Security',
    'CryptoKit',

    // Notifications & Background
    'UserNotifications',
    'BackgroundTasks',

    // Accessibility
    'Accessibility',

    // App Services
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

    // Testing
    'XCTest',
    'Testing',

    // System
    'os',
    'Darwin',
    'Dispatch',
    'ObjectiveC',
    'PlaygroundSupport',

    // Swift Package Manager
    'PackageDescription',
]);

// ---------------------------------------------------------------------------
// Source directory candidates
// ---------------------------------------------------------------------------

const SOURCE_DIRS = ['Sources', 'Source', 'src', 'App', 'Modules'];

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Find a Swift file matching the module name in the given directory tree.
 * Checks for: dir/<module>/<module>.swift, dir/<module>/main.swift, etc.
 */
function findSwiftModule(baseDir: string, moduleName: string): string | null {
    // Try direct file: <baseDir>/<moduleName>.swift
    const directFile = join(baseDir, `${moduleName}.swift`);
    if (cachedExists(directFile)) {
        return resolvePath(directFile);
    }

    // Try directory: <baseDir>/<moduleName>/
    const moduleDir = join(baseDir, moduleName);
    if (cachedExists(moduleDir)) {
        // Look for <moduleName>.swift inside the directory
        const mainFile = join(moduleDir, `${moduleName}.swift`);
        if (cachedExists(mainFile)) {
            return resolvePath(mainFile);
        }

        // Look for any .swift file
        try {
            const files = cachedReaddir(moduleDir).sort();
            const swiftFile = files.find((f) => f.endsWith('.swift'));
            if (swiftFile) {
                return resolvePath(join(moduleDir, swiftFile));
            }
        } catch {
            /* not a directory */
        }
    }

    return null;
}

export function resolve(_from: string, modulePath: string, repoRoot: string): string | null {
    // Framework/system imports → null
    if (SWIFT_FRAMEWORKS.has(modulePath)) {
        return null;
    }

    // Try each source directory candidate
    for (const srcDir of SOURCE_DIRS) {
        const base = join(repoRoot, srcDir);
        if (!cachedExists(base)) {
            continue;
        }

        const result = findSwiftModule(base, modulePath);
        if (result) {
            return result;
        }

        // Also scan one level deep (for SPM multi-target packages)
        try {
            const entries = cachedReaddir(base);
            for (const entry of entries) {
                const subDir = join(base, entry);
                const subResult = findSwiftModule(subDir, modulePath);
                if (subResult) {
                    return subResult;
                }
            }
        } catch {
            /* ignore */
        }
    }

    // Try root directory directly
    const rootResult = findSwiftModule(repoRoot, modulePath);
    if (rootResult) {
        return rootResult;
    }

    return null;
}
