import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  Lightbox,
  LIGHTBOX_MAX_ZOOM,
  LIGHTBOX_MIN_ZOOM,
  LIGHTBOX_ZOOM_STEP,
  type LightboxImage,
} from '../src/web-parity/components/ui/Lightbox';

const IMAGES: LightboxImage[] = [
  {src: 'https://example.test/a.jpg', alt: 'Front', caption: 'Front view'},
  {src: 'https://example.test/b.jpg', alt: 'Rear'},
];

test('exposes the canonical zoom constants from the web component', () => {
  expect(LIGHTBOX_MIN_ZOOM).toBe(1);
  expect(LIGHTBOX_MAX_ZOOM).toBe(5);
  expect(LIGHTBOX_ZOOM_STEP).toBe(0.5);
});

test('renders nothing when closed or when there are no images', async () => {
  let closed: ReactTestRenderer.ReactTestRenderer | undefined;
  let empty: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    closed = ReactTestRenderer.create(
      <Lightbox open={false} onClose={() => undefined} images={IMAGES} />,
    );
    empty = ReactTestRenderer.create(
      <Lightbox open onClose={() => undefined} images={[]} />,
    );
  });

  expect(closed?.toJSON()).toBeNull();
  expect(empty?.toJSON()).toBeNull();
});

test('renders counter, caption, zoom level and navigation when open', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <Lightbox open onClose={() => undefined} images={IMAGES} />,
    );
  });

  const serialized = JSON.stringify(tree?.toJSON());

  expect(serialized).toContain('1 / 2');
  expect(serialized).toContain('Front view');
  expect(serialized).toContain('100%');
  expect(serialized).toContain('lightbox-image');
  expect(serialized).toContain('lightbox-prev');
  expect(serialized).toContain('lightbox-next');
  expect(serialized).toContain('lightbox-skeleton');
  // No DOM/web embedding leaked into the native tree.
  expect(serialized).not.toContain('WebView');
});

test('invokes onClose from the backdrop press handler', async () => {
  const handleClose = jest.fn();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <Lightbox open onClose={handleClose} images={IMAGES} />,
    );
  });

  const backdrop = tree?.root.findByProps({testID: 'lightbox-backdrop'});
  await ReactTestRenderer.act(async () => {
    backdrop?.props.onPress();
  });

  expect(handleClose).toHaveBeenCalledTimes(1);
});

test('clamps an out-of-range initialIndex to the last image', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <Lightbox
        open
        onClose={() => undefined}
        images={IMAGES}
        initialIndex={99}
      />,
    );
  });

  // initialIndex 99 clamps to images.length-1 (index 1) -> counter "2 / 2".
  expect(JSON.stringify(tree?.toJSON())).toContain('2 / 2');
});
