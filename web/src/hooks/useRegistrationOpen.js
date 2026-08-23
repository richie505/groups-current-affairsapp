import { useEffect, useState } from 'react';
import { api } from '../api/client';

// Whether this deployment lets people sign themselves up.
//
// Asked of the server rather than assumed, because it is a per-deployment
// choice (ALLOW_REGISTRATION) and the client cannot read the environment. Until
// the answer arrives the state is `null`, and callers should render neither
// branch — showing "Register" and then snatching it away is worse than a
// moment's blank.
//
// A failed request is treated as CLOSED. The pages that use this decide whether
// to offer sign-up, and offering a route that will 403 is the mistake worth
// avoiding; briefly hiding a link that would have worked is not.
export default function useRegistrationOpen() {
  const [open, setOpen] = useState(null);
  useEffect(() => {
    let alive = true;
    api
      .get('/auth/config')
      .then((c) => alive && setOpen(!!c.registration_open))
      .catch(() => alive && setOpen(false));
    return () => {
      alive = false;
    };
  }, []);
  return open;
}
