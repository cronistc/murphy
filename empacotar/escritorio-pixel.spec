# Gerado a partir deste arquivo por empacotar/construir-rpm.sh (que preenche a versão).
%global debug_package %{nil}
# O Claude Code embutido é um executável único: "strip" e afins o quebram.
%global __os_install_post %{nil}
%global __strip /bin/true
%global _build_id_links none
%define _binary_payload w19.zstdio

Name:           escritorio-pixel
Version:        @VERSAO@
Release:        1
Summary:        Escritório em pixel art com funcionários de IA que trabalham de verdade
License:        Proprietary
URL:            https://github.com/cronistc/murphy
BuildArch:      x86_64
AutoReqProv:    no
Requires:       /usr/bin/node
Requires:       /usr/bin/git
Requires:       /usr/bin/script
Requires:       python3
Requires:       python3-gobject
Requires:       gtk4
Requires:       webkitgtk6.0

%description
Um escritório 2D em que funcionários de IA (Claude Code, com a sua conta)
trabalham de verdade: digitam, pesquisam, rodam testes e vêm até a sua mesa
pedir permissão e entregar o trabalho.

%install
mkdir -p %{buildroot}/usr/lib/escritorio-pixel %{buildroot}/usr/bin \
         %{buildroot}/usr/share/applications %{buildroot}/usr/share/icons/hicolor/256x256/apps
cp -a %{_sourcedir}/app/. %{buildroot}/usr/lib/escritorio-pixel/
install -m 0755 %{_sourcedir}/escritorio-pixel %{buildroot}/usr/bin/escritorio-pixel
install -m 0644 %{_sourcedir}/io.github.cronistc.EscritorioPixel.desktop %{buildroot}/usr/share/applications/
install -m 0644 %{_sourcedir}/icone.png %{buildroot}/usr/share/icons/hicolor/256x256/apps/io.github.cronistc.EscritorioPixel.png

%files
/usr/lib/escritorio-pixel
/usr/bin/escritorio-pixel
/usr/share/applications/io.github.cronistc.EscritorioPixel.desktop
/usr/share/icons/hicolor/256x256/apps/io.github.cronistc.EscritorioPixel.png
