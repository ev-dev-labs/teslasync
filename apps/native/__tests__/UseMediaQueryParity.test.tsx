import React from 'react';
import {
  Dimensions,
  Text,
  type EmitterSubscription,
  type ScaledSize,
} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import {
  useIsCoarsePointer,
  useIsMobile,
  useMediaQuery,
} from '../src/web-parity/hooks/useMediaQuery';

type DimsChangeListener = (dims: {
  window: ScaledSize;
  screen: ScaledSize;
}) => void;

function dims(width: number, height: number): ScaledSize {
  return {width, height, scale: 2, fontScale: 1};
}

function QueryProbe({query}: {query: string}) {
  const matches = useMediaQuery(query);
  return <Text>{matches ? 'match' : 'nomatch'}</Text>;
}

function MobileProbe() {
  const matches = useIsMobile();
  return <Text>{matches ? 'match' : 'nomatch'}</Text>;
}

function CoarsePointerProbe() {
  const matches = useIsCoarsePointer();
  return <Text>{matches ? 'match' : 'nomatch'}</Text>;
}

function text(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return JSON.stringify(tree?.toJSON());
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('(max-width: 640px) matches a narrow window and not a wide one', async () => {
  jest.spyOn(Dimensions, 'get').mockReturnValue(dims(320, 640));
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<QueryProbe query="(max-width: 640px)" />);
  });
  expect(text(tree)).toContain('match');
  expect(text(tree)).not.toContain('nomatch');
  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });

  jest.spyOn(Dimensions, 'get').mockReturnValue(dims(1024, 768));
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<QueryProbe query="(max-width: 640px)" />);
  });
  expect(text(tree)).toContain('nomatch');
  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('(min-width: 768px) matches a wide window only', async () => {
  jest.spyOn(Dimensions, 'get').mockReturnValue(dims(1024, 768));
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<QueryProbe query="(min-width: 768px)" />);
  });
  expect(text(tree)).toContain('match');
  expect(text(tree)).not.toContain('nomatch');
  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('useIsMobile reflects the 640px breakpoint', async () => {
  jest.spyOn(Dimensions, 'get').mockReturnValue(dims(390, 844));
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<MobileProbe />);
  });
  expect(text(tree)).toContain('match');
  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('useIsCoarsePointer is true on the touch (ios) test platform', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<CoarsePointerProbe />);
  });
  expect(text(tree)).toContain('match');
  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('(prefers-reduced-motion: reduce) defaults to false when not enabled', async () => {
  jest.spyOn(Dimensions, 'get').mockReturnValue(dims(390, 844));
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <QueryProbe query="(prefers-reduced-motion: reduce)" />,
    );
  });
  expect(text(tree)).toContain('nomatch');
  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('re-evaluates when the window dimensions change', async () => {
  jest.spyOn(Dimensions, 'get').mockReturnValue(dims(1024, 768));
  let changeListener: DimsChangeListener | undefined;
  const remove = jest.fn();
  jest
    .spyOn(Dimensions, 'addEventListener')
    .mockImplementation((type, handler) => {
      if (type === 'change') {
        changeListener = handler as DimsChangeListener;
      }
      return {remove} as unknown as EmitterSubscription;
    });

  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<QueryProbe query="(max-width: 640px)" />);
  });
  expect(text(tree)).toContain('nomatch');

  // Shrink below the breakpoint and fire the captured Dimensions listener.
  jest.spyOn(Dimensions, 'get').mockReturnValue(dims(320, 640));
  await ReactTestRenderer.act(async () => {
    changeListener?.({window: dims(320, 640), screen: dims(320, 640)});
  });
  expect(text(tree)).toContain('match');
  expect(text(tree)).not.toContain('nomatch');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
  expect(remove).toHaveBeenCalled();
});
