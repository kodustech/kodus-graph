export function qualifiedName(filePath: string, name: string, className?: string, isTest?: boolean): string {
  if (isTest) return `${filePath}::test:${name}`;
  if (className) return `${filePath}::${className}.${name}`;
  return `${filePath}::${name}`;
}
