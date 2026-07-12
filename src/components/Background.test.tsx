import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { SpotifyImage } from '../types';
import { Background } from './Background';

function img(url: string, width = 640): SpotifyImage {
  return { url, width, height: width };
}

function imgs(container: HTMLElement): HTMLImageElement[] {
  return Array.from(container.querySelectorAll('img'));
}

describe('Background', () => {
  it('renders the image immediately', () => {
    const { container } = render(<Background images={[img('A')]} />);
    const found = imgs(container);
    expect(found).toHaveLength(1);
    expect(found[0].src).toContain('A');
  });

  it('picks the smallest image at least 500px wide', () => {
    const { container } = render(
      <Background images={[img('tiny', 200), img('right-size', 640), img('huge', 2000)]} />,
    );
    expect(imgs(container)[0].src).toContain('right-size');
  });

  it('falls back to the smallest image when none reach 500px', () => {
    const { container } = render(<Background images={[img('big', 400), img('small', 200)]} />);
    expect(imgs(container)[0].src).toContain('small');
  });

  it('renders the Music2 fallback when there are no images', () => {
    const { container } = render(<Background images={[]} />);
    expect(imgs(container)).toHaveLength(0);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
