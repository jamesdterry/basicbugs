export function debounce(fn, ms = 200) {
  let handle = null;
  function debounced(...args) {
    if (handle != null) clearTimeout(handle);
    handle = setTimeout(() => {
      handle = null;
      fn.apply(null, args);
    }, ms);
  }
  debounced.cancel = () => {
    if (handle != null) {
      clearTimeout(handle);
      handle = null;
    }
  };
  return debounced;
}
