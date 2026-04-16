/**
 * Scala import resolver.
 *
 * Scala shares the JVM ecosystem with Java (Maven/Gradle/SBT), so it reuses
 * the Java resolver. Keep this file as a thin re-export to preserve the
 * co-located language folder structure.
 */

export { resolve } from '../java/resolver';
