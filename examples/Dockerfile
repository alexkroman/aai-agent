FROM nginx:alpine
COPY . /usr/share/nginx/html/
RUN chmod +x /usr/share/nginx/html/docker-entrypoint.sh
EXPOSE 80
ENTRYPOINT ["/usr/share/nginx/html/docker-entrypoint.sh"]
