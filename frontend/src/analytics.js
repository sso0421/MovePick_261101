// 유틸리티 함수 : 필요할 때에만 값을 가져다가 사용하고자 할 때

export function trackEvent(eventName, parameters = {}) {
  if (typeof window === "undefined") {
    return;
  }

  window.dataLayer = window.dataLayer || [];

  window.dataLayer.push({
    event: eventName,
    ...parameters,
  });
}
