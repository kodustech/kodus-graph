/**
 * Kotlin import resolver.
 *
 * Kotlin shares the JVM ecosystem with Java (Maven/Gradle), so it reuses
 * the Java resolver. Keep this file as a thin re-export to preserve the
 * co-located language folder structure.
 */

export { resolve } from '../java/resolver';
