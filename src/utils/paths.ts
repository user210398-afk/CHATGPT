import { identifier } from '../../schema/exam';
export function sitePath(relative: string): string {
  return `${import.meta.env.BASE_URL}${relative}`;
}
export function examUrl(id: string): string {
  return `${sitePath('')}?exam=${encodeURIComponent(identifier.parse(id))}`;
}
