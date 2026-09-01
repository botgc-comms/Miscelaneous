if (location.hash.startsWith('#trophy/') || ['#catalogue', '#signup', '#login'].includes(location.hash)) {
  location.replace('/archive.html' + location.hash);
}
