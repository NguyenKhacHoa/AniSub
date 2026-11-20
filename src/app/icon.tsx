import { ImageResponse } from 'next/og';

export const size = {
  width: 192,
  height: 192,
};

export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#06070A',
          borderRadius: 42,
        }}
      >
        <div
          style={{
            width: 164,
            height: 164,
            borderRadius: 36,
            backgroundColor: '#0F1117',
            border: '2px solid rgba(255, 255, 255, 0.14)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 100,
              height: 100,
              borderRadius: 24,
              backgroundColor: '#E11D48',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="46" height="46" viewBox="0 0 24 24" fill="#F8FAFC">
              <path d="M6.5 4.8L19.5 12L6.5 19.2V4.8Z" />
            </svg>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
