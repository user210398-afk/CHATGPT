import type { Exam } from '../../types/exam';
import { sitePath } from '../../utils/paths';
export function Images({ images }: { images: Exam['images'] }) {
  return images.map((image) => (
    <figure key={image.src}>
      <img src={sitePath(image.src)} alt={image.alt} loading="lazy" />
      {image.caption && <figcaption>{image.caption}</figcaption>}
    </figure>
  ));
}
