// 시험 실행용: 앱 코드의 "@/lib/..." 경로를 src/lib/....ts 파일로 이어 준다(Next.js 없이 Node로 바로 계산 시험).
export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    return next(new URL(`../../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  }
  return next(specifier, context);
}
