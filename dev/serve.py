# make serve puts public/ at the root and dev/ under /dev/, so a probe and
# the app it frames share an origin. With no Worker, /api and every path
# with no file answer 404.
import http.server
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        self.directory = REPO if path.startswith('/dev/') else os.path.join(REPO, 'public')
        return super().translate_path(path)


http.server.test(HandlerClass=Handler, port=int(sys.argv[1]) if len(sys.argv) > 1 else 8932)
