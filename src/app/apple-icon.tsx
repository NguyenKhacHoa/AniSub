import { ImageResponse } from 'next/og';

export const size = {
  width: 180,
  height: 180,
};

export const contentType = 'image/png';

export default function AppleIcon() {
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
        }}
      >
        <div
          style={{
            width: 152,
            height: 152,
            borderRadius: 34,
            backgroundColor: '#0F1117',
            border: '2px solid rgba(255, 255, 255, 0.14)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 94,
              height: 94,
              borderRadius: 22,
              backgroundColor: '#E11D48',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="42" height="42" viewBox="0 0 24 24" fill="#F8FAFC">
              <path d="M6.5 4.8L19.5 12L6.5 19.2V4.8Z" />
            </svg>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
