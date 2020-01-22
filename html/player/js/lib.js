if (localStorage.confighistorical == undefined)
{
    localStorage.confighistorical = false;
}

if (localStorage.configcompilations == undefined)
{
    localStorage.configcompilations = false;
}

if (localStorage.smartradio == undefined)
{
    localStorage.smartradio = false;
}

if (localStorage.lastcomposerid == undefined)
{
    localStorage.lastcomposerid = 145;
}

conc_playbuffer = {};
conc_favorites = [];
conc_favoritecomposers = [];
conc_forbiddencomposers = [];
conc_favoriteworks = [];
conc_playlists = {};
conc_onair = false;
conc_radioqueue = [];
conc_radiofilter = {};
conc_disabled = false;
conc_lastplayerstatus = false;
conc_seek = 0;
conc_seekto = 0;

conc_options = {
    historical: JSON.parse(localStorage.confighistorical),
    compilations: JSON.parse(localStorage.configcompilations),
    timeout: 10000,
    backend: 'https://' + (window.location.hostname.split('.')[0] == 'beta' ? 'beta.' : '') + 'api.' + window.location.hostname.replace('beta.',''),
    opusbackend: 'https://' + (window.location.hostname.split('.')[0] == 'beta' ? 'beta.' : '') + 'api.openopus.' + (window.location.hostname.split('.').pop() == 'local' ? 'local' : 'org'),
    publicsite: 'https://getconcertino.com',
    shareurl: 'https://' + (window.location.hostname.split('.')[0] == 'beta' ? 'beta.' : '') + 'cncert.' + (window.location.hostname.split('.').pop() == 'local' ? 'local' : 'in'),
    smartradio: JSON.parse(localStorage.smartradio),
    notshow: false,
    version: '1.20' + (window.location.hostname.split('.')[0] == 'beta' ? ' beta' : ''),
    secondsEMEcert: 12 * 60,
    too_many_tracks: 24,
    no_track_labels: 15
};

window.onpopstate = function (event) {
  if (window.location.hash) {
    conc_mobilepage(window.location.hash.replace('#',''));
  } else if (window.location.pathname != "/") {
    vars = window.location.pathname.split("/");
    if (vars[1] == "u") {
      conc_recording(vars[2], vars[3], vars[4], 1);
    }
    else if (vars[1] == "p") {
      conc_playlistdetail(parseInt(vars[2], 16));
    }
  }
};

// common auth

conc_commonauth = function () {

  // treating urls

  if (window.location.pathname != "/") {
    vars = window.location.pathname.split("/");
    if (vars[1] == "u") {
      localStorage.lastwid = vars[2];
      localStorage.lastaid = vars[3];
      localStorage.lastset = vars[4];
    }
    else if (vars[1] == "p") {
      conc_playlistdetail(parseInt(vars[2], 16));
    }
  }

}

// guest auth

conc_guestauth = function () {

  conc_disabled = true;
  conc_disabledreason = "premiumneeded";

  conc_commonauth ();

  $.ajax ({
    url: conc_options.backend + '/dyn/user/login/',
    method: "POST",
    data: { auth: conc_authgen(), id: localStorage.user_id, recid: 'guest-' + ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)) },
    success: function(response)
    {
      if (response.status.success == "true")
      {
        localStorage.user_id = response.user.id;
        localStorage.user_type = 'guest';
        if (response.user.auth) localStorage.user_auth = response.user.auth;

        conc_init();
      }
    }
  });
}

// apple music logout

conc_logout = function () {
  applemusic.unauthorize().then(function() {
    localStorage.user_type = '';
    if ($(window).width() >= 1024) $('#config').closeModal();
    $('#loader').show(0, function () { $('#loader-loading').hide(0, function () { $('#loader-options').show(); }); });
  });
}

// apple music auth

conc_appleauth = function () {

  conc_commonauth ();

  // removing guest info - not ideal, but it's supposed that guest accounts = throwaway accounts

  if (localStorage.user_type == 'guest') {
    localStorage.user_id = '';
  }

  // apple music login

  applemusic = MusicKit.getInstance();
  applemusic.authorize().then(function() {

    // retrieves the first recommendation as user identifier (since Apple doesn't provide any id aside temp tokens)

    applemusic.api.recommendations().then(function (response) { 
      
      $.ajax ({
        url: conc_options.backend + '/dyn/user/login/',
        method: "POST",
        data: { auth: conc_authgen(), id: localStorage.user_id, recid: response[0].id },
        success: function(response)
        {
          if (response.status.success == "true")
          {
            conc_disabled = false;
            conc_disabledreason = "";

            /* detecting home screen app on iphone */

            if (window.matchMedia('(display-mode: standalone)').matches && !!navigator.userAgent.match(/Version\/[\d\.]+.*Safari/)) {
              conc_disabled = true;
              conc_disabledreason = "homescreen";
            }

            localStorage.user_type = 'applemusic';
            localStorage.user_id = response.user.id;
            if (response.user.auth) localStorage.user_auth = response.user.auth;
  
            conc_init();
            conc_showplayerbar();
  
            if (localStorage.lastwid) {
              conc_recording(localStorage.lastwid, localStorage.lastaid, localStorage.lastset, (window.location.search != "?play"));
            }
  
            applemusic.addEventListener('playbackTimeDidChange', function () { conc_slider ({id: (applemusic.player.nowPlayingItem ? applemusic.player.nowPlayingItem.id : 0), duration: applemusic.player.currentPlaybackDuration, position: applemusic.player.currentPlaybackTime }); });
            applemusic.addEventListener('playbackStateDidChange', function () { conc_state (applemusic.player.playbackState); });
            applemusic.addEventListener('mediaCanPlay', function () { 
              if (conc_seek) {
                applemusic.player.volume = 0;
                conc_seekto = conc_seek;
                conc_seek = 0;
                setTimeout (function () { applemusic.player.seekToTime (conc_seekto+1).then(function () { applemusic.player.volume = 1; }); }, 5000);
              } 
            });

            applechecking = setInterval(conc_checkplayer, 150000);
            
            $('#loader').fadeOut();
          }
          else
          {
             // do something if login fails
          }
        }
      });      
    });
  });
}

conc_toggleplay = function ()
{
  applemusic = MusicKit.getInstance();

  if (applemusic.player.queue.isEmpty || (applemusic.player.playbackState == 10 && applemusic.player.queue.nextPlayableItemIndex == undefined))
  {
    conc_appleplay (conc_playbuffer.tracks, 0);
  }
  else
  {  
    if (applemusic.player.isPlaying)
    {
      applemusic.player.pause ();
    }
    else
    {
      applemusic.player.play ();
    }
  }
}

conc_nexttrack = function ()
{
  $(".slider").find('.bar').css('width', '0%');
  $(".timer").html('0:00');

  applemusic = MusicKit.getInstance();
  applemusic.player.skipToNextItem();
}

conc_prevtrack = function ()
{
  $(".slider").find('.bar').css('width', '0%');
  $(".timer").html('0:00');

  applemusic = MusicKit.getInstance();
  applemusic.player.skipToPreviousItem();
}

conc_track = function (offset)
{
  if (conc_disabled) {
    $('#tuning-modal').hide();
    $(`#${conc_disabledreason}`).leanModal();
    return;
  } else {
    applemusic = MusicKit.getInstance();
    if (applemusic.player.queue.length) {
      applemusic.player.changeToMediaAtIndex (offset);
    }
    else {
      conc_appleplay (conc_playbuffer.tracks, offset);
    }
  }
}

// player state

conc_state = function (state)
{
  applemusic = MusicKit.getInstance();

  switch (state)
  {
    case 1:
    case 6:
    case 8:
    case 9:
    case 1800:
        $('#playpause').attr("class", "loading");
        if (state == 1800 && conc_prevstate == 2 && !conc_seek) {
          conc_seek = applemusic.player.currentPlaybackTime;
          conc_appleplay (conc_playbuffer.tracks, applemusic.player.nowPlayingItemIndex);
        }
        if (state == 6) conc_seekto = 0;
      break;
    case 2:
        if (!conc_seekto) {
          $('#playpause').attr("class", "pause");
        }
      break;
    case 3:
        $('#playpause').attr("class", "play");
      break;
    case 4:
    case 5:
    case 10:
        $(".slider").find('.bar').css('width', '0%');
        $(".timer").html('0:00');
        $("#timerglobal").html('0:00');
        $('#playpause').attr("class", "play");
        if (state == 10) conc_radioskip();
      break;
  }

  conc_prevstate = state;
}

// player slider

conc_slider = function (arg)
{
  if (arg.position == arg.duration)
  {
    $("#timer-"+arg.id).html("0:00");
    $("#slider-"+arg.id).find('.bar').css('width', '0%');
    if (!$('#playercontrols').hasClass('toomanytracks')) $("#globalslider-"+arg.id).find('.bar').css('width', '0%');
  }
  else if (!conc_seekto && !conc_seek)
  {
    $("#timerglobal").html(conc_readabletime(conc_playbuffer.accdurations[conc_playbuffer.tracks.indexOf(arg.id)] + arg.position));
    if ($('#playercontrols').hasClass('toomanytracks')) $("#globalslider-total").find('.bar').css('width', (100*(conc_playbuffer.accdurations[conc_playbuffer.tracks.indexOf(arg.id)] + arg.position)/conc_playbuffer.accdurations[conc_playbuffer.accdurations.length - 1]) + '%');

    $("#timer-"+arg.id).html(conc_readabletime(arg.position));
    $("#slider-"+arg.id).find('.bar').css('width', (100*arg.position/arg.duration) + '%');
    $("#globalslider-"+arg.id).find('.bar').css('width', (100*arg.position/arg.duration) + '%');

    if (arg.position != 0 && (arg.position % conc_options.secondsEMEcert) === 0) {
      conc_seek = arg.position;
      applemusic = MusicKit.getInstance();
      conc_appleplay (conc_playbuffer.tracks, applemusic.player.nowPlayingItemIndex);
    }
  }
}

// slug gen

conc_slug = function (str)
{
  str = str.replace(/^\s+|\s+$/g, ''); // trim
  str = str.toLowerCase();

  // remove accents, swap ñ for n, etc
  var from = "ãàáäâẽèéëêìíïîõòóöôùúüûñç·/_,:;";
  var to   = "aaaaaeeeeeiiiiooooouuuunc------";
  for (var i=0, l=from.length ; i<l ; i++) {
    str = str.replace(new RegExp(from.charAt(i), 'g'), to.charAt(i));
  }

  str = str.replace(/[^a-z0-9 -]/g, '') // remove invalid chars
    .replace(/\s+/g, '-') // collapse whitespace and replace by -
    .replace(/-+/g, '-'); // collapse dashes

  return str;
};

// converting seconds to string

conc_readabletime = function(time)
{
    if (time && time > 0.0)
    {
        var sec = parseInt(time % (60));
        var min = parseInt(time / (60));

        if (min > 59) {
          var minutes = parseInt(min % (60));
          var part = parseInt(min / (60)) + ':' + (minutes < 10 ? '0'+minutes : minutes);
        } else {
          var part = min;
        }

        return part + ':' + (sec < 10 ? '0'+sec : sec);
    }
    else
    {
        return '0:00';
    }
}

// composer list

conc_composersbyname = function (letter)
{
  $.ajax({
    url: conc_options.opusbackend + '/composer/list/name/' + letter + '.json',
    method: "GET",
    success: function (response) {
      conc_composers (response);
    }
  });
}

conc_composersbysearch = function (search)
{
  if (search.length > 3)
  {
    $.ajax({
      url: conc_options.opusbackend + '/composer/list/search/' + search + '.json',
      method: "GET",
      success: function (response) {
        conc_composers(response);
      }
    });
  }
  else if (search.length == 0)
  {
    conc_composersbytag ('pop');
  }
}

conc_composersbyepoch = function (epoch)
{
  $.ajax({
    url: conc_options.opusbackend + '/composer/list/epoch/' + epoch + '.json',
    method: "GET",
    success: function (response) {
      conc_composers(response);
    }
  });
}

conc_composersbyfav = function ()
{
  $.ajax({
    url: conc_options.backend + '/user/' + localStorage.user_id + '/composer/fav.json',
    method: "GET",
    success: function (response) {
      conc_composers(response);
    }
  });
}

conc_composersbytag = function (tag) {
  $.ajax({
    url: conc_options.opusbackend + '/composer/list/' + tag + '.json',
    method: "GET",
    success: function (response) {
      conc_composers(response);
    }
  });
}

conc_composers = function (response)
{
  var list = response;

    if (1==1 || list.status.success == "true")
    {
      compcontent = '';

      switch (list.request.type)
      {
        case "epoch":
          compcontent = '<li class="index period">' + list.request.item + '</li>';
          if (list.request.item == 'all') {
            $('#main #maincomposerlist').html('All composers');
          } else {
            $('#main #maincomposerlist').html('Composers of the ' + list.request.item + ' period');
          }
          $('#library #composersearch').val('');
          break;

        case "search":
          compcontent = '<li class="index search"></li>';
          $('#main #maincomposerlist').html('Search results');
          $('#library select.periods').val('all');
          $('#library select.periods').trigger('change.select2');
          break;

        case "fav":
          compcontent = '<li class="index favorite">Favorites</li>';
          if (list.status.success == "true") $('#favoritecomposers').removeClass('empty');
          $('#library #composersearch').val('');
          $('#library select.periods').val('all');
          $('#library select.periods').trigger('change.select2');
          break;

        case "pop":
          compcontent = '<li class="index popular">Popular</li>';
          $('#main #maincomposerlist').html('Most requested composers');
          $('#library #composersearch').val('');
          $('#library select.periods').val('all');
          $('#library select.periods').trigger('change.select2');
          break;

        case "rec":
          compcontent = '<li class="index recommended">Essential</li>';
          $('#main #maincomposerlist').html('Essential composers');
          $('#library #composersearch').val('');
          $('#library select.periods').val('all');
          $('#library select.periods').trigger('change.select2');
          break;

        case "name":
        default:
          if (list.request.item == "all")
          {
            compcontent = '<li class="index all">All</li>';
            $('#main #maincomposerlist').html('All composers');
          }
          else
          {
            compcontent = '<li class="index">'+list.request.item+'</li>';
          }
          $('#library #composersearch').val('');
          $('#library select.periods').val('all');
          $('#library select.periods').trigger('change.select2');
          break;
      }

      if (list.request.type == "fav" && $(window).width() < 1024)
      {
        ulcomposers = $('#favoritecomposerslist');
        ulcomposers.html('');
      }
      else 
      {
        ulcomposers = $('#composers');
        ulcomposers.html(compcontent);
      }

      docs = list.composers;
      for (composer in docs)
      {
        if (!docs[composer].death) docs[composer].death = '0000';
        
        if ($.inArray(docs[composer].id.toString(), conc_favoritecomposers) != -1)
        {
          cfav = 'favorite';
        }
        else
        {
          cfav = '';
        }

        if ($.inArray(docs[composer].id.toString(), conc_forbiddencomposers) != -1) 
        {
          cforb = 'forbidden';
        }
        else
        {
          cforb = '';
        }
        
        ulcomposers.append('<li class="composer"><ul class="composerdetails"><li class="photo"><a href="javascript:conc_genresbycomposer(\'' + docs[composer].id + '\');"><img src="' + docs[composer].portrait + '" /></a></li><li class="name"><a href="javascript:conc_genresbycomposer(\'' + docs[composer].id + '\');">' + docs[composer].name + '</a></li><li class="fullname">' + docs[composer].complete_name + '</li><li class="dates">(' + docs[composer].birth.substring(0, 4) + (docs[composer].death.substring(0, 4) != '0000' ? '-' + docs[composer].death.substring(0, 4) : '') + ')</li><li id="forb_' + docs[composer].id + '" class="forb ' + cforb + '"><a href="javascript:conc_compforbid(\'' + docs[composer].id + '\', \'#forb_' + docs[composer].id + '\');">forbidden</a></li><li id="cfav_' + docs[composer].id + '" class="fav ' + cfav + '"><a href="javascript:conc_compfavorite(\'' + docs[composer].id + '\', \'#cfav_' + docs[composer].id + '\');">fav</a></li><li class="radio"><a href="javascript:conc_newradio({composer:' + docs[composer].id + '});">radio</a></li></ul></li>');
      }

      $('#composers').scrollLeft(0);
    }
    /*else
    {
      $('#composers').html(compcontent);
    }*/
}

// genres list

conc_genresbycomposer = function (composer, genre, auto=false)
{
  window.albumlistnext = 0;

  $.ajax({
    url: conc_options.opusbackend + '/genre/list/composer/' + composer + '.json',
    method: "GET",
    success: function (response) {
      
      var list = response;

      if (list.status.success == "true") {
        localStorage.lastcomposerid = list.composer.id;

        if (!list.composer.death) list.composer.death = '0000';
        
        $('#composerprofile li.portrait').html('<img src="' + list.composer.portrait + '" />');
        $('#composerprofile li.name').html(list.composer.name);
        $('#composerprofile li.completename').html(list.composer.complete_name);
        $('#composerprofile li.dates').html('(' + list.composer.birth.substring(0, 4) + (list.composer.death.substring(0, 4) != '0000' ? '-' + list.composer.death.substring(0, 4) : '') + ')');
        
        if ($.inArray(list.composer.id.toString(), conc_favoritecomposers) != -1) {
          cfav = 'favorite';
        }
        else {
          cfav = '';
        }

        if ($.inArray(list.composer.id.toString(), conc_forbiddencomposers) != -1) {
          cforb = 'forbidden';
        }
        else {
          cforb = '';
        }
        
        $('#composerprofile li.buttons').html('<a id="mforb_' + list.composer.id + '" href="javascript:conc_compforbid(\'' + list.composer.id + '\', \'' + '#mforb_' + list.composer.id + '\');" class="forb ' + cforb + '">forbidden</a><a id="mfav_' + list.composer.id + '" href="javascript:conc_compfavorite(\'' + list.composer.id + '\', \'#mfav_' + list.composer.id + '\');" class="fav ' + cfav + '">fav</a>');

        $('#genresworks h4').html('');
        $('#playlistdetail').hide();
        $('#genresworks div.deskonly h2').html('<a href="javascript:conc_genresbycomposer (' + list.composer.id + ')">' + list.composer.name + '</a>');
        $('#genresworks h3').html('');
        $('#genres').css("display", "inline-block");
        $('#works').css("display", "inline-block");
        $('#searchbywork').css("display", "block");
        $('#genres').html('');
        $('#works').html('');
        $('#albums').html('');
        $('#albums').hide();

        $('#genres').append('<li id="all"><a href="javascript:conc_worksbycomposer(\'' + list.composer.id + '\',\'all\');"><span>icon</span>All</a><a class="radio" href="javascript:conc_newradio({composer:' + list.composer.id + '});">radio</a></li>');
        $('#genres').append('<li id="fav"><a href="javascript:conc_listfavoriteworks(\'' + list.composer.id + '\');"><span>icon</span>Favorites</a><a class="radio" href="javascript:conc_newradio({composer:' + list.composer.id + ',work:\'fav\'});">radio</a></li>');

        var lastgenre = '';

        docsg = list.genres;
        for (dgenre in docsg) {
          $('#genres').append('<li id="' + conc_slug(docsg[dgenre]) + '"><a href="javascript:conc_worksbycomposer(\'' + list.composer.id + '\',\'' + docsg[dgenre] + '\');"><span>icon</span>' + (docsg[dgenre] == 'Recommended' ? 'Essential' : docsg[dgenre]) + '</a><a class="radio" href="javascript:conc_newradio({composer:' + list.composer.id + ',genre:\'' + docsg[dgenre] + '\'});">radio</a></li>');
        }

        if (!genre) {
          if ($('#genres #recommended').length) {
            genre = 'Recommended';
          }
          else {
            genre = 'all';
          }
        }

        if (genre == 'fav') {
          conc_listfavoriteworks(list.composer.id);
        }
        else {
          conc_worksbycomposer(list.composer.id, genre);
        }

        $('#genresworks h2.mobonly').html('works');
        
        if (auto) { 
          conc_mobilepage ('library');
        } else {
          conc_mobilepage ('composer');
        }
      }
      
    }
  });
}

// works list

conc_worksbycomposer = function (composer, genre)
{
  $('#worksearch').val('');
  $.ajax({
    url: conc_options.opusbackend + '/work/list/composer/' + composer + '/' + genre + '.json',
    method: "GET",
    success: function (response) {
      conc_works(response);
    }
  });
}

conc_listfavoriteworks = function (composer) 
{
  $('#worksearch').val('');

  $.ajax({
    url: conc_options.backend + '/user/' + localStorage.user_id + '/composer/' + composer + '/work/fav.json',
    method: "GET",
    success: function (response) {
      conc_works(response);
    }
  });
}

conc_worksbysearch = function (composer, genre, search)
{
  if (genre == 'fav' && search.length > 3)
  {
    $.ajax({
      url: conc_options.backend + '/user/' + localStorage.user_id + '/composer/' + composer + '/work/fav/search/' + search + '.json',
      method: "GET",
      success: function (response) {
        conc_works(response);
      }
    });
  }
  else if (search.length > 3)
  {
    $.ajax({
      url: conc_options.opusbackend + '/work/list/composer/' + composer + '/genre/' + genre + '/search/' + search + '.json',
      method: "GET",
      success: function (response) {
        conc_works(response);
      }
    });
  }
  else if (genre == 'fav' && search.length == 0)
  {
    conc_listfavoriteworks (composer);
  }
  else if (search.length == 0)
  {
    conc_worksbycomposer (composer, genre);
  }
}

conc_works = function (response)
{
  var list = response;

  localStorage.lastgenre = list.request.item;

  $('#works').html('');
  $('#albums').html('');

  $('#genres li').removeClass('active');
  $('#'+conc_slug(list.request.item)).addClass('active');

  $('#works').html('');

  docsw = list.works;
  lastrec = '';
  lastgenre = '';

  for (work in docsw) {
    favorite = '';
    if ($.inArray(docsw[work].id.toString(), conc_favoriteworks) != -1) {
      favorite = 'favorite';
    }

    if (list.request.item == 'Recommended' || list.request.item == 'Popular' || list.request.item == 'fav') {
      if (lastgenre != docsw[work].genre) {
        $('#works').append('<li class="separator">' + docsw[work].genre + '</li>');
      }
    }
    else if (lastrec != docsw[work].recommended && !(lastrec == '' && docsw[work].recommended == '0')) {
      $('#works').append('<li class="separator">' + (docsw[work].recommended == 1 ? 'Essential': 'Other works') + '</li>');
    }

    //docsw[work].title = docsw[work].title.replace(/\"/g, "");
    $('#works').append('<li><a href="javascript:conc_favoritework(\'' + docsw[work].id + '\',\'' + list.composer.id + '\')" class="wfav wfav_' + docsw[work].id + ' ' + favorite + '">fav</a><a href="javascript:conc_recordingsbywork(' + docsw[work].id + ',0);">' + docsw[work].title + '<span>' + docsw[work].subtitle + ' </span></a></li>');

    lastrec = docsw[work].recommended;
    lastgenre = docsw[work].genre;
  }

  $("#works li.separator").prev().addClass('beforeseparator');
  $('#radioslider em').html($('#composerprofile li.name').html() + ' ' + ($('#genres li.active a').html().toLowerCase().includes('all') ? '' : $('#genres li.active a').html().toLowerCase()) + ($('#genres li.active a').html().toLowerCase().includes('favorites') ? '' : ' works'));
}

// recordings list

conc_recordingsbywork = function (work, offset)
{
  $('#worksearch').val('');
  window.albumlistwork = work;
  window.albumlistoffset = offset;
  window.albumlistnext = 0;

  if (!offset) {
    $('#genres').css("display", "none");
    $('#works').css("display", "none");
    $('#searchbywork').css("display", "none");
    $('#playlistdetail').hide();
    $('#playlistradio').hide();
    $('#albums').removeClass();
    $('#albums').html('');
    $('#genresworks div.deskonly h2').html('');
    $('#genresworks h3').html('');
    $('#genresworks h4').html('');
    $('#albums').addClass(work.toString());
    $('#albums').show();
    $('#workprofile').hide();
    $('#genresworks h2.mobonly').html('recordings').hide();;
    conc_mobilepage ('work');
    $('#albums.'+work).append('<li class="loading firstload"></li>');
  }
  else {
    $('#albums.'+work).append('<li class="loading"></li>');
  }
  
  $.ajax({
    url: conc_options.backend + '/recording/list/work/' + work + '/' + offset + '.json',
    method: "GET",
    success: function (response) {

      var list = response;
      $('li.loading').remove();
      listul = '#albums.' + list.work.id;

      if ($('#albums').attr('class') == work.toString()) {
        $('#genresworks div.deskonly h2').html('<a href="javascript:conc_genresbycomposer (' + list.work.composer.id + ')">' + list.work.composer.name + '</a>');
        $('#genresworks h3').html(list.work.title);
        $('#genresworks h4').html(list.work.subtitle);

        $('#workprofile li.back').html('<a href="javascript:conc_genresbycomposer (' + list.work.composer.id + ')">back</a>');
        $('#workprofile li.name').html(list.work.composer.name);
        $('#workprofile li.title').html(list.work.title);
        $('#workprofile li.subtitle').html(list.work.subtitle);

        if ($.inArray(list.work.id.toString(), conc_favoriteworks) != -1) {
          mwfav = 'favorite';
        }
        else {
          mwfav = '';
        }
        
        $('#workprofile li.buttons').html('<a id="mwfav_' + list.work.id + '" href="javascript:conc_favoritework(\'' + list.work.id + '\', \'' + list.work.composer.id + '\');" class="fav ' + mwfav + '">fav</a>');
      }

      if (list.status.success == "true") {
        window.albumlistnext = list.next;
        docsr = list.recordings;

        for (performance in docsr) {
  
          draggable = "";
          pidsort = "";
          extraclass = "";
          extratitle = "";

          notshow = false;

          if (docsr[performance].compilation == "true") {
            if (!conc_options.compilations) {
              notshow = true;
            }
          }

          if (docsr[performance].historical == "true") {
            if (!conc_options.historical) {
              notshow = true;
            }
          }

          if (docsr[performance].verified == "true") {
            extraclass = "verified";
            extratitle = "Verified recording";
          }

          if (!notshow && !$("ul#albums." + list.work.id + " li[pid=" + list.work.id + '-' + docsr[performance].apple_albumid + '-' + docsr[performance].set + "]").length) {
            $(listul).append('<li pid="' + list.work.id + '-' + docsr[performance].apple_albumid + '-' + docsr[performance].set + '" ' + pidsort + ' class="performance ' + draggable + ' ' + extraclass + '" title="'+ extratitle + '"><ul>' + conc_recordingitem(docsr[performance], list.work) + '</ul></li>');
          }
        }

        if (list.status.rows <= 4 && list.next)
        {
          conc_recordingsbywork(list.work.id, list.next);
        }
      }

      if (list.status.success == "false") $(listul).append('<li class="emptylist"><p>Concertino couldn\'t find any recording of this work in the Apple Music catalog. It might be an error, though. Please <a href="mailto:concertino@openopus.org">reach us</a> if you know a recording. This will help us correct our algorithm.</p></li>')
      if (!list.next && list.status.success == "true") $(listul).append('<li class="disclaimer"><p>Those recordings were fetched automatically from the Apple Music catalog. The list might be inaccurate or incomplete. Please <a href="mailto:concertino@openopus.org">reach us</a> for requests, questions or suggestions.</p></li>');

      $('#genresworks h2.mobonly').show();
      $('#workprofile').show();
    }
  });
}

// random recording

conc_randomrecording = function (wid) {
  
  $.ajax({
    url: conc_options.backend + '/recording/list/work/' + wid + '/0.json',
    method: "GET",
    success: function (response) {
      
      if (response.status.success == "true") {

        if (!conc_options.compilations) {
          comprec = [];

          for (rec in response.recordings) {
            if (response.recordings[rec].compilation != "true") {
              comprec.push(response.recordings[rec]);
            }
          }
        }
        else {
          comprec = response.recordings;
        }

        var rnd = Math.floor((Math.random() * (comprec.length - 1)));
        var rcd = comprec[rnd];
        conc_recording(wid, rcd["apple_albumid"], rcd["set"]);
      }
      else {
        conc_radioskip();
      }
    }
  });
}

// recording detail

conc_thisrecording = function (album, wid, set) {
  $('#radiotop #goradio').removeClass('on');
  $('#playercontrols #skip').removeClass('radio');
  $('#radiotop select').prop("disabled", false);

  conc_radioqueue = [];
  conc_radiofilter = {};
  conc_onair = false;
  $('body').removeClass('radioonair');

  conc_recording (wid, album, set);
}

conc_recording = function (wid, album, set, auto)
{
  if (!auto)
  {
    $('#tuning-modal').leanModal();
    $('#worksearch').val('');
  }

  $.ajax({
    url: conc_options.backend + '/recording/detail/work/' + wid + '/album/' + album + '/' + set + '.json',
    method: "GET",
    success: function (response) {
      $('#nowplaying').css('display', "block");
      if (conc_disabled) {
        $('body').removeClass("showingplayerbar");
      }
      else {
        $('body').addClass("showingplayerbar");
      }
      $("#timerglobal").html('0:00');
      conc_recordingaction (response, auto);
    }
  });
}

conc_recordingaction = function (list, auto)
{
  if (list.status.success == "true") {

    if (list.recording.length == 0) {
      conc_notavailable();
    }
    else {

      $('body').addClass('showingnowplaying');

      if (window.location.pathname != '/u/' + list.work.id + '/' + list.recording.apple_albumid + '/' + list.recording.set) {
        window.history.pushState({}, 'Concertino', '/u/' + list.work.id + '/' + list.recording.apple_albumid + '/' + list.recording.set);
      }

      document.title = `${list.work.composer.name}: ${list.work.title}`;
      gtag ('config', 'UA-89195986-5', {'page_path': '/u/' + list.work.id + '/' + list.recording.apple_albumid + '/' + list.recording.set });

      $('#playerinfo').html(conc_recordingitem(list.recording, list.work));

      verify = '<li class="notverified"><a href="javascript:conc_qualify()">This recording was fetched automatically with no human verification. Is everything right? Click here and help us to improve our data.</a></li>';
      verify += '<li class="verified"><a href="javascript:conc_qualify()">This recording was verified by a human and its metadata were considered right. Disagree? Click here and help us to improve our data.</a></li>';
      verify += '<li class="report">Thanks for reporting. This recording will be excluded from our database.</li>';

      pform = [];
      for (i in list.recording.performers) {
        pform.push (list.recording.performers[i].name + (list.recording.performers[i].role != '' && list.recording.performers[i].role != 'Orchestra' && list.recording.performers[i].role != 'Ensemble' && list.recording.performers[i].role != 'Choir' ? ', ' + list.recording.performers[i].role : ''));
      }
      
      verify += '<li class="perform"><a href="javascript:conc_editperformers();conc_qualify();">Thanks for your collaboration! Edit the performers in the field below. One per line. Specify their roles (instrument, voice etc) after commas.</a><textarea>'+pform.join('\n')+'</textarea><a class="submit" href="javascript:conc_submitperf(' + list.work.id + ',\'' + list.recording.apple_albumid + '\',' + list.recording.set + ')">Done</a></li>';
      verify += '<li class="versionform"><a href="javascript:conc_editobs();conc_qualify();">Thanks for your help! Specify below which version of the work this recording uses, including instrumentation and author, if not the composer</a><textarea>'+list.work.subtitle+'</textarea><a class="submit" href="javascript:conc_submitobs(' + list.work.id + ',\'' + list.recording.apple_albumid + '\',' + list.recording.set + ')">Done</a></li>';

      verify += '<li class="tagloading">loading</li>';
      verify += '<li class="button verify"><a href="javascript:conc_rectag(' + list.work.id + ',\'' + list.recording.apple_albumid + '\',' + list.recording.set + ',\'verified\',1)"><strong>Everything OK!</strong>Metadata are correct and the recording is complete</a></li>';
      verify += '<li class="button edit"><a href="javascript:conc_editperformers()"><strong>Complete but missing information</strong>Recording is complete but data on performers is lacking</a></li>';
      verify += '<li class="button partial"><a href="javascript:conc_rectag(' + list.work.id + ',\'' + list.recording.apple_albumid + '\',' + list.recording.set + ',\'compilation\',1)"><strong>Correct but incomplete</strong>Metadata are correct but the recording is missing movements</a></li>';
      verify += '<li class="button version"><a href="javascript:conc_editobs()"><strong>Correct but a different version</strong>Not the original work - it\'s an arrangement or adaptation</a></li>';
      
      verify += '<li class="button wrongdata"><a href="javascript:conc_rectag(' + list.work.id + ',\'' + list.recording.apple_albumid + '\',' + list.recording.set + ',\'wrongdata\',1)"><strong>Wrong work</strong>The description doesn\'t match the recording</a></li>';
      verify += '<li class="button badquality"><a href="javascript:conc_rectag(' + list.work.id + ',\'' + list.recording.apple_albumid + '\',' + list.recording.set + ',\'badquality\',1)"><strong>Bad quality recording</strong>This isn\'t a real recording - it\'s played by a computer</a></li>';

      $('#playerverify').html(verify);
      $('#playerverify').removeClass('reported').toggleClass('verified', (list.recording.verified == 'true'));
      $('#playertracks').html('');
      $('#globaltracks').html('');

      $('#playercontrols').removeClass("toolong toomanytracks nolabels");
      
      if (list.recording.length >= 3600) {
        $('#playercontrols').addClass("toolong");
      }

      if (list.recording.tracks.length > conc_options.no_track_labels) {
        $('#playercontrols').addClass("nolabels");
      }

      var currtrack = 0;
      conc_playbuffer.accdurations = [0];
      conc_playbuffer.tracks = [];
      conc_playbuffer.tracksuris = list.recording.apple_tracks;

      for (track in list.recording.tracks) {
        conc_playbuffer.tracks[track] = list.recording.tracks[track].apple_trackid;
        conc_playbuffer.accdurations[parseInt(track) + 1] = parseInt(list.recording.tracks[track].length) + parseInt(conc_playbuffer.accdurations[parseInt(track)]);

        var pctsize = ((list.recording.tracks[track].length) / list.recording.length) * 100;
        currtrack = currtrack + 1;
        $('#playertracks').append('<li><a class="tracktitle" href="javascript:conc_track(' + track + ')">' + list.recording.tracks[track].title + '</a><div id="timer-' + list.recording.tracks[track].apple_trackid + '" class="timer">0:00</div><div id="slider-' + list.recording.tracks[track].apple_trackid + '" class="slider"><div class="buffer"></div><div class="bar"></div></div><div class="duration">' + conc_readabletime(list.recording.tracks[track].length) + '</div></li>');

        if (list.recording.tracks.length <= conc_options.too_many_tracks) {
          $('#globaltracks').append('<li style="width: calc(' + Math.round(pctsize * 1000) / 1000 + '%' + ')"><a class="tracktitle" href="javascript:conc_track(' + track + ')">' + currtrack + '</a><div id="globalslider-' + list.recording.tracks[track].apple_trackid + '" class="slider"><div class="buffer"></div><div class="bar"></div></div></li>');
        }
      }

      if (list.recording.tracks.length > conc_options.too_many_tracks) {
        $('#playercontrols').addClass("toomanytracks");
        $('#globaltracks').append('<li style="width: 100%"><div id="globalslider-total" class="slider"><div class="buffer"></div><div class="bar"></div></div></li>');
      }

      $('#durationglobal').html(conc_readabletime(list.recording.length));
      $(".slider").find('.bar').css('width', '0%');
      $(".timer").html('0:00');

      if (!auto) {
        conc_mobilepage ('player');
        conc_appleplay(list.recording.apple_tracks, 0);

        // registering play
        localStorage.lastwid = list.work.id;
        localStorage.lastaid = list.recording.apple_albumid;
        localStorage.lastset = list.recording.set;
        $.ajax({
          url: conc_options.backend + '/dyn/user/recording/played/',
          method: "POST",
          data: { id: localStorage.user_id, wid: list.work.id, aid: list.recording.apple_albumid, set: list.recording.set, cover: list.recording.cover, performers: JSON.stringify(list.recording.performers), auth: conc_authgen() },
          success: function (response) {
            if ($('#favtitle select option:checked').val() == 'rec') {
              conc_recentrecordings();
            }
          }
        });
      }
    }
  }
}

conc_playingdetails = function ()
{
    if ($('body').hasClass('player'))
    {
      $('#nowplaying').attr('class', 'up');
      $('body').removeClass('player');
    }
    else
    {
      $('#nowplaying').attr('class', 'down');
      $('body').addClass('player');
    }
}

// check if player is ready

conc_checkplayer = function ()
{
  applemusic = MusicKit.getInstance();
  if (!applemusic.player.isPlaying && !conc_lastplayerstatus)
  {
    applemusic.setQueue({
      songs: []
    }).then(function () { conc_lastplayerstatus = false; });
  }
  else
  {
    conc_lastplayerstatus = applemusic.player.isPlaying;
  }
}

// play recording

conc_appleplay = function (tracks, offset)
{
  if (conc_disabled) {
    $('#tuning-modal').hide();
    $(`#${conc_disabledreason}`).leanModal();
    return;
  }

  if ((/iP(hone|od|ad)/.test(navigator.platform)) && !localStorage.iphonewarning) {
    $('#tuning-modal').hide(0, function () { $("#mobile-safari").leanModal(); });
    localStorage.iphonewarning = true;
    iphonewarning = true;
  }
  else {
    iphonewarning = false;
  }

  applemusic = MusicKit.getInstance();

  if (applemusic.player.isPlaying) applemusic.player.stop();
  applemusic.setQueue({
    songs: tracks
  }).then(function () {
    if (!conc_seek && !conc_seekto) { 
      $(".slider").find('.bar').css('width', '0%');
      $(".timer").html('0:00');
      if (conc_onair) conc_notification($('#nowplaying li.work a').html().split("<")[0], $('#nowplaying li.cover a img')[0].currentSrc, $('#nowplaying li.composer a').html());
    }
    applemusic.changeToMediaAtIndex(offset).
      catch(function () { conc_notavailable (); });

    if (!iphonewarning) $('#tuning-modal').closeModal();
    
  }).catch(function () { conc_notavailable (); });  
}

// recording item

conc_recordingitem = function (item, work, playlist)
{
  if (typeof item.label === 'undefined') item.label = '';
  if (typeof work.subtitle === 'undefined') work.subtitle = '';
  if (typeof item.observation === 'undefined') item.observation = '';

  alb = '';

  alb = alb + '<li class="cover"><a href="javascript:conc_thisrecording(\'' + item.apple_albumid +'\','+work.id+','+item.set+')">';
  alb = alb + '<img src="' + item.cover + '" onerror="this.src=\'/img/nocover.png\'" />';
  alb = alb + '<div class="overlay"></div></a></li>';

  alb = alb+'<li class="composer"><a href="javascript:conc_genresbycomposer('+work.composer.id+')">'+work.composer.name+'</a></li>';
  alb = alb + '<li class="work"><a href="javascript:conc_recordingsbywork(' + work.id + ',0)">' + work.title +'<span>' + work.subtitle + '</span></a></li>';
  if (item.observation) alb = alb + '<li class="version">' + item.observation + '</li>';

  var apple_link = 'https://geo.music.apple.com/us/album/-/' + item.apple_albumid;

  if (typeof item.apple_tracks !== 'undefined') {
    if (item.apple_tracks.length == 1) {
      apple_link = apple_link + '?i=' + item.apple_tracks[0];
    }
  }

  alb = alb + '<li class="performers"><ul>' + conc_listperformers(item.performers) + '</ul></li>';
  alb = alb + '<li class="label">'+item.label+'</li>';
  alb = alb + '<li class="apple"><a href="' + apple_link + '" target="_blank">Listen on Apple Music</a></li>';

  rid = work.id + '-' + item.apple_albumid + '-' + item.set;

  if ($.inArray(rid, conc_favorites) != -1)
  {
    alb = alb + '<li class="favorite"><a href="javascript:conc_recfavorite(' + work.id + ',\'' + item.apple_albumid + '\',' + item.set + ')" class="is fav_' + rid + '">unfavorite</a></li>';
  }
  else
  {
    alb = alb + '<li class="favorite"><a href="javascript:conc_recfavorite(' + work.id + ',\'' + item.apple_albumid + '\',' + item.set + ')" class="go fav_' + rid + '">favorite</a></li>';
  }

  alb = alb + '<li class="permalink"><a href="javascript:conc_permalink(' + work.id + ',\'' + item.apple_albumid + '\',' + item.set + ')">permalink</a></li>';
  
  if (playlist) {
    if (playlist.owner.id == localStorage.user_id) {
      plaction = 'unplaylist';
      plfunction = 'conc_unplaylistperformance(' + work.id + ',\'' + item.apple_albumid + '\',' + item.set + ',' + playlist.id + ')';
    }
    else {
      plaction = 'doplaylist';
      plfunction = 'conc_playlistmodal(' + work.id + ',\'' + item.apple_albumid + '\',' + item.set + ')';
    }
  }
  else {
    plaction = 'doplaylist';
    plfunction = 'conc_playlistmodal(' + work.id + ',\'' + item.apple_albumid + '\',' + item.set + ')';
  }

  alb = alb + '<li class="playlist '+ plaction +'"><a href="javascript:'+ plfunction +'">playlist</a></li>';

  return alb;
}

// performers list

conc_listperformers = function (aperformers) {

  albpone = [];
  albptwo = [];
  albptwohalf = [];
  albpthree = [];
  albc = '';
  albo = '';
  albor = '';
  classmain = '';

  if (aperformers.length <= 4)
  {
      classmain = 'mainperformer';
  }

  perfnum = 0;

  for (performers in aperformers)
  {
    if (aperformers[performers].role === null)
    {
      aperformers[performers].role = "";
    }

    if (aperformers[performers].role.trim() == "Conductor")
    {
      albpthree.push ('<li class="mainperformer"><strong>'+aperformers[performers].name+'</strong>, ' + aperformers[performers].role + '</li>');
    }
    else if (aperformers[performers].role.trim() == "Ensemble" || aperformers[performers].role.trim() == "Orchestra")
    {
      albptwo.push ('<li class="mainperformer"><strong>'+aperformers[performers].name+'</strong></li>');
    }
    else if (aperformers[performers].role.trim() == "Choir")
    {
      albptwohalf.push ('<li class="'+classmain+'"><strong>'+aperformers[performers].name+'</strong></li>');
    }
    else if (aperformers[performers].role.trim() == "")
    {
      albpone.push ('<li class="' + classmain + '"><strong>' + aperformers[performers].name + '</strong></li>');
    }
    else
    {
      albpone.push ('<li class="'+classmain+'"><strong>'+aperformers[performers].name+'</strong>, ' + aperformers[performers].role + '</li>');
    }
  }

  if (aperformers.length > 4 && albpthree.length == 0 && albptwo.length == 0) {
    for (oneperfs in albpone) {
      if (oneperfs <= 3) albpone[oneperfs] = albpone[oneperfs].replace ('class=""', 'class="mainperformer"');
    }
  }

  return albpone.join('') + albptwo.join('') + albptwohalf.join('') + albpthree.join('');
}

// error messages

conc_notavailable = function () {

  if (conc_disabled) return;

  if (conc_onair) {
    conc_radioskip();
  }
  else {
    applemusic.setQueue({
      songs: []
    }).then(function () {
      $('#tuning-modal').hide(0, function () { $("#notavailable").leanModal(); });
    });
  }
}

// showing playing bar

conc_showplayerbar = function ()
{
  $('body').addClass('showingplayerbar');
}

// notification

conc_notification = function (text, icon, title)
{
  if (conc_disabled) return;

  let options =
    {
      body: text,
      icon: icon,
      silent: true
    };

  if ($(window).width() >= 1024) {
    var n = new Notification (title, options);
    setTimeout(n.close.bind(n), 5000);
  }
}

// generating auth hash

conc_authgen = function ()
{
  let timestamp = (((new Date() / 1000 | 0) + (60 * 1)) / (60 * 5) | 0);
  let auth = md5 (timestamp + "-" + localStorage.user_id + "-" + localStorage.user_auth);

  return auth;
}

// tagging or untagging a recording

conc_rectag = function (wid, aid, set, tag, value) {
  rid = wid + '-' + aid + '-' + set;
  if (value == 1) {
    action = 'tag';
  }
  else {
    action = 'untag';
  }

  $('#playerverify').toggleClass('loading');

  $.ajax({
    url: conc_options.backend + '/recording/detail/work/' + wid + '/album/' + aid + '/' + set + '.json',
    method: "GET",
    success: function (response) {

      $.ajax({
        url: conc_options.backend + '/dyn/recording/' + action + '/',
        method: "POST",
        data: { id: localStorage.user_id, wid: wid, aid: aid, set: set, cover: response.recording.cover, performers: JSON.stringify(response.recording.performers), auth: conc_authgen(), tag: tag },
        success: function (nresponse) {
          if (nresponse.status.success == "true") {

            $('#playerverify').toggleClass('loading');
            $('#playerverify').toggleClass('opened');

            if (action == 'tag') {

              if (tag == 'verified' || tag == 'compilation') {
                $('#playerverify').toggleClass('verified', true);
                if (window.albumlistwork == wid) {
                  $('#albums li[pid=' + wid + '-' + aid + '-' + set + ']').show();
                  $('#albums li[pid=' + wid + '-' + aid + '-' + set + ']').toggleClass('verified', true);
                  $('#albums li[pid=' + wid + '-' + aid + '-' + set + ']').parent().prepend($('#albums li[pid=' + wid + '-' + aid + '-' + set + ']'));
                }
              }
              else if (tag == 'wrongdata' || tag == 'badquality') {
                $('#playerverify').toggleClass('reported', true);
                if (window.albumlistwork == wid) $('#albums li[pid=' + wid + '-' + aid + '-' + set + ']').hide();
              }
            }
          }
        }
      });

    }
  });
}

// editing performers of a recording 

conc_editperformers = function () {
  $('#playerverify').toggleClass('editingperf');
}

conc_submitperf = function (wid, aid, set) {

  if ($('#nowplaying textarea').val().length > 0) {

    $('#playerverify').toggleClass('loading');

    $.ajax({
      url: conc_options.backend + '/recording/detail/work/' + wid + '/album/' + aid + '/' + set + '.json',
      method: "GET",
      success: function (response) {

        $.ajax({
          url: conc_options.backend + '/dyn/recording/edit/',
          method: "POST",
          data: { id: localStorage.user_id, wid: wid, aid: aid, set: set, auth: conc_authgen(), cover: response.recording.cover, performers: JSON.stringify(response.recording.performers), newperformers: $('#nowplaying li.perform textarea').val() },
          success: function (response) {
            if (response.status.success == "true") {

              $('#playerverify').toggleClass('loading');
              $('#playerverify').toggleClass('editingperf');
              $('#playerverify').toggleClass('verified', true);
              $('#playerverify').toggleClass('opened', false);

              $('#nowplaying li.performers ul').html(conc_listperformers(response.recording.performers));

              if (window.albumlistwork == wid) {
                $('#albums li[pid=' + wid + '-' + aid + '-' + set + ']').show();
                $('#albums li[pid=' + wid + '-' + aid + '-' + set + '] li.performers').html(conc_listperformers(response.recording.performers));
                $('#albums li[pid=' + wid + '-' + aid + '-' + set + ']').toggleClass('verified', true);
                $('#albums li[pid=' + wid + '-' + aid + '-' + set + ']').parent().prepend($('#albums li[pid=' + wid + '-' + aid + '-' + set + ']'));
              }
            }
          }
        });

      }
    });
  }
}

// editing recording observation

conc_editobs = function () {
  $('#playerverify').toggleClass('editingobs');
}

conc_submitobs = function (wid, aid, set) {

  $('#playerverify').toggleClass('loading');

  $.ajax({
    url: conc_options.backend + '/recording/detail/work/' + wid + '/album/' + aid + '/' + set + '.json',
    method: "GET",
    success: function (response) {

      $.ajax({
        url: conc_options.backend + '/dyn/recording/edit/',
        method: "POST",
        data: { id: localStorage.user_id, wid: wid, aid: aid, set: set, auth: conc_authgen(), cover: response.recording.cover, performers: JSON.stringify(response.recording.performers), observation: 1, observationvalue: $('#nowplaying li.versionform textarea').val() },
        success: function (rresponse) {
          if (rresponse.status.success == "true") {

            $('#playerverify').toggleClass('loading');
            $('#playerverify').toggleClass('editingobs');
            $('#playerverify').toggleClass('verified', true);
            $('#playerverify').toggleClass('opened', false);

            $('#nowplaying li.work').html('<a href="javascript:conc_recordingsbywork(' + response.work.id + ',0)">' + response.work.title +'<span>' + rresponse.recording.observation + '</span></a>');

            if (window.albumlistwork == wid) {
              $('#albums li[pid=' + wid + '-' + aid + '-' + set + ']').show();
              $('#albums li[pid=' + wid + '-' + aid + '-' + set + '] li.version').remove();
              if (rresponse.recording.observation) $('<li class="version">'+rresponse.recording.observation+'</li>').insertBefore('#albums li[pid=' + wid + '-' + aid + '-' + set + '] li.performers');
              $('#albums li[pid=' + wid + '-' + aid + '-' + set + ']').toggleClass('verified', true);
              $('#albums li[pid=' + wid + '-' + aid + '-' + set + ']').parent().prepend($('#albums li[pid=' + wid + '-' + aid + '-' + set + ']'));
            }
          }
        }
      });

    }
  });
}

// adding or removing favorite recording

conc_recfavorite = function (wid, aid, set)
{
  rid = wid + '-' + aid + '-' + set;
  if ($.inArray(rid, conc_favorites) != -1)
  {
    action = 'unfavorite';
  }
  else
  {
    action = 'favorite';
  }

  $.ajax({
    url: conc_options.backend + '/recording/detail/work/' + wid + '/album/' + aid + '/' + set + '.json',
    method: "GET",
    success: function (response) {

      $.ajax({
        url: conc_options.backend + '/dyn/user/recording/' + action + '/',
        method: "POST",
        data: { id: localStorage.user_id, wid: wid, aid: aid, set: set, cover: response.recording.cover, performers: JSON.stringify(response.recording.performers), auth: conc_authgen() },
        success: function (response) {
          if (response.status.success == "true") {
            
            if (action == 'favorite') {
              $('.fav_' + rid).removeClass('go');
              $('.fav_' + rid).addClass('is');
            }
            else {
              $('.fav_' + rid).removeClass('is');
              $('.fav_' + rid).addClass('go');
            }

            if (action == 'favorite' || $('#favtitle select').val() == "fav") {
              conc_playlist("fav");
            }
          }
        }
      });

    }
  });  
}

// adding or removing favorite work

conc_favoritework = function (wid, cid) {
  if ($.inArray(wid.toString(), conc_favoriteworks) != -1) {
    action = 'unfavorite';
  }
  else {
    action = 'favorite';
  }

  $.ajax({
    url: conc_options.backend + '/dyn/user/work/' + action + '/',
    method: "POST",
    data: { id: localStorage.user_id, wid: wid, cid: cid, auth: conc_authgen() },
    success: function (response) {
      if (response.status.success == "true") {
        conc_favoriteworks = (response.list ? response.list : []);
        $('.wfav_' + wid).toggleClass('favorite');
        $('#mwfav_' + wid).toggleClass('favorite');

        if ($('li#fav').hasClass('active') && $(window).width() >= 1024) {
          conc_listfavoriteworks(localStorage.lastcomposerid);
        }
      }
    }
  });
}

// initializing interface

conc_init = function ()
{
  $.ajax({
    url: conc_options.backend + '/user/' + localStorage.user_id + '/lists.json',
    method: "GET",
    success: function (response) 
    {
      conc_favoritecomposers = (response.favorite ? response.favorite : []);
      conc_forbiddencomposers = (response.forbidden ? response.forbidden : []);
      conc_favoriteworks = (response.works ? response.works : []);
      conc_playlists = (response.playlists ? response.playlists : {});

      conc_composersbytag('pop');
      conc_genresbycomposer(localStorage.lastcomposerid, localStorage.lastgenre, true);
      conc_playlist("fav");

      if ($(window).width() < 1024) {
        conc_composersbyfav();
      }

      conc_mobilepage('library');
      if (localStorage.lastwid) {
        conc_recording(localStorage.lastwid, localStorage.lastaid, localStorage.lastset, true);
      }
      $('#loader').fadeOut();
    }
  });
}

// favorite recordings

conc_favoriterecordings = function ()
{
  $('#favorites .performance').remove();
  $.ajax({
    url: conc_options.backend + '/user/' + localStorage.user_id + '/recording/fav.json',
    method: "GET",
    success: function (response) {
      conc_favorites = response.list;
      docsr = response.recordings;
      listul = '#favalbums';
      draggable = "";
      pidsort = "";

      if (response.status.success == "false") {
        $('#favalbumswrapper').addClass('nofavorites');
      } else {
        $('#favalbumswrapper').removeClass('nofavorites');
      
        for (performance in docsr) {
          $(listul).append('<li pid="' + docsr[performance].work.id + '-' + docsr[performance].apple_albumid + '-' + docsr[performance].set + '" ' + pidsort + ' class="performance ' + draggable + '"><ul>' + conc_recordingitem(docsr[performance], docsr[performance].work) + '</ul></li>');
        }
      }
    }
  });
}

// recent recordings

conc_recentrecordings = function () {
  $('#favorites .performance').remove();
  $.ajax({
    url: conc_options.backend + '/user/' + localStorage.user_id + '/recording/recent.json',
    method: "GET",
    success: function (response) {
      docsr = response.recordings;
      listul = '#favalbums';
      $('#favalbumswrapper').removeClass('nofavorites');

      for (performance in docsr) {
        $(listul).append('<li pid="' + docsr[performance].work.id + '-' + docsr[performance].apple_albumid + '-' + docsr[performance].set + '" class="performance"><ul>' + conc_recordingitem(docsr[performance], docsr[performance].work) + '</ul></li>');
      }
    }
  });
}

// playlist recordings

conc_playlistrecordings = function (pid) {
  $('#favorites .performance').remove();
  $.ajax({
    url: conc_options.backend + '/recording/list/playlist/'+pid+'.json',
    method: "GET",
    success: function (response) {

      if (response.status.success == "false") {
        conc_playlist("fav");
      } else {
        docsr = response.recordings;
        listul = '#favalbums';
        draggable = "draggable";
        pidsort = "";
        $('#favalbumswrapper').removeClass('nofavorites');

        for (performance in docsr) {
          $(listul).append('<li pid="' + docsr[performance].work.id + '-' + docsr[performance].apple_albumid + '-' + docsr[performance].set + '" class="performance"><ul>' + conc_recordingitem(docsr[performance], docsr[performance].work, response.playlist) + '</ul></li>');
        }
      }
    }
  });
}

// adding or removing favorite composers

conc_compfavorite = function (cid, classcheck) {
  if ($(classcheck).hasClass('favorite'))
  {
    action = 'unfavorite';
  }
  else 
  {
    action = 'favorite';
  }

  $.ajax({
    url: conc_options.backend + '/dyn/user/composer/' + action + '/',
    method: "POST",
    data: { id: localStorage.user_id, cid: cid, auth: conc_authgen() },
    success: function (response) {
      if (response.status.success == "true") {
        
        conc_favoritecomposers = (response.list ? response.list : []);

        $('#cfav_' + cid).toggleClass('favorite');
        $('#mfav_' + cid).toggleClass('favorite');

        if ($(window).width() < 1024 || $('#composers li.index').hasClass('favorite')) {
          conc_composersbyfav();
        }
      }
    }
  });
}

// adding or removing forbidden composers

conc_compforbid = function (cid, classcheck) {
  if ($(classcheck).hasClass('forbidden')) {
    action = 'permit';
  }
  else {
    action = 'forbid';
  }

  $.ajax({
    url: conc_options.backend + '/dyn/user/composer/' + action + '/',
    method: "POST",
    data: { id: localStorage.user_id, cid: cid, auth: conc_authgen() },
    success: function (response) {
      if (response.status.success == "true") {

        conc_forbiddencomposers = (response.list ? response.list : []);

        $('#forb_' + cid).toggleClass('forbidden');
        $('#mforb_' + cid).toggleClass('forbidden');
      }
    }
  });
}

// playlists menu

conc_listplaylists = function (playlist_slug) {
  $('#favtitle select').css('visibility', 'hidden');

  if (!playlist_slug || playlist_slug == "fav") {
    playlist_slug = "fav";
    $('#sidebar').removeClass('sequenplay');
  }
  else if (playlist_slug == "rec") {
    playlist_slug = "rec";
    $('#sidebar').removeClass('sequenplay');
  }
  else {
    $('#sidebar').addClass('sequenplay');
  }

  $('#favtitle select').html('');
  $('#playlist-menu').html('');

  var favoption = new Option("Favorites", "fav");
  $('#favtitle select').append($(favoption));

  var favoption = new Option("Recently Played", "rec");
  $('#favtitle select').append($(favoption));

  $('#playlist-menu').append('<li class="favorites" id="playlist_fav"><a href="javascript:conc_playlist(\'fav\');">Your favorites</a></li><li class="recently" id="playlist_rec"><a href="javascript:conc_playlist(\'rec\');">Recently played</a></li>');

  for (pllst in conc_playlists)
  {
    var favoption = new Option(conc_playlists[pllst].name, conc_playlists[pllst].id);
    var summary = conc_playlists[pllst].summary.works.rows + ' work' + (conc_playlists[pllst].summary.works.rows > 1 ? 's' : '') + ' by ' + conc_playlists[pllst].summary.composers.names.slice (0,4).join (', ');
    var portraits = '';

    for (cpid in conc_playlists[pllst].summary.composers.portraits.slice (0, 4)) {
      var portraits = portraits + '<img src="' + conc_playlists[pllst].summary.composers.portraits[cpid] + '" />'; 
    }

    $('#favtitle select').append($(favoption));
    $('#playlist-menu').append('<li id="playlist_' + conc_playlists[pllst].id + '" class="playlist"><a href="javascript:conc_playlist(\'' + conc_playlists[pllst].id + '\')"><span class="portraits composers-' + conc_playlists[pllst].summary.composers.portraits.slice (0, 4).length + '">' + portraits + '</span><span class="title">' + conc_playlists[pllst].name + '</span><span class="summary">' + summary + '</span></a></li>');
  }

  $('#playlist-menu li#playlist_' + playlist_slug).addClass('active');
  $('#favtitle select').val(playlist_slug);
  $('#favtitle select').css('visibility', 'visible');
}

conc_playlist = function (playlist) {
  $('ul#favalbums').removeClass().addClass((playlist == "fav" || playlist == "rec") ? playlist : "playlist");
  $('body').removeClass("playlist").addClass((playlist == "fav" || playlist == "rec") ? "" : "playlist");
  
  conc_listplaylists (playlist);
  if (playlist == "fav") {
    conc_favoriterecordings();
  }
  else if (playlist == "rec") {
    conc_recentrecordings();
  }
  else {
    conc_playlistrecordings(playlist);
  }
  conc_mobilepage ("favorites");
}

// playlist modal

conc_playlistmodal = function (wid, aid, set) {
  $('#playlistmodal #existingplaylist').html('');
  var favoptions = Array();
  
  var favoption = new Option("Choose a playlist", "0");
  $('#playlistmodal #existingplaylist').append($(favoption));

  for (pllst in conc_playlists) {
    if (conc_playlists[pllst].owner == localStorage.user_id)
    {
      var favoption = new Option(conc_playlists[pllst].name, conc_playlists[pllst].id);
      $('#playlistmodal #existingplaylist').append($(favoption));
    } 
  }

  $('#playlistmodal #newplaylist').val('');
  window.playlistwid = wid;
  window.playlistaid = aid;
  window.playlistset = set;
  $('#tuning-modal').hide(0, function () { $("#playlistmodal").leanModal(); });
}

conc_addtoplaylist = function () {

  if ($('#playlistmodal #newplaylist').val() != "") {
    conc_playlistperformance(window.playlistwid, window.playlistaid, window.playlistset, 'new', $('#playlistmodal #newplaylist').val(), 1);
  }
  else if ($('#playlistmodal #existingplaylist').val() != "0") {
    conc_playlistperformance(window.playlistwid, window.playlistaid, window.playlistset, $('#playlistmodal #existingplaylist').val(), $('#playlistmodal #existingplaylist option:checked').text(), 1);
  }
}

// add to playlist

conc_playlistperformance = function (wid, aid, set, pid, name) {

  $.ajax({
    url: conc_options.backend + '/recording/detail/work/' + wid + '/album/' + aid + '/' + set + '.json',
    method: "GET",
    success: function (response) {
      
      $.ajax({
        url: conc_options.backend + '/dyn/recording/addplaylist/',
        method: "POST",
        data: { id: localStorage.user_id, wid: wid, aid: aid, set: set, pid: pid, name: name, cover: response.recording.cover, performers: JSON.stringify(response.recording.performers), auth: conc_authgen() },
        success: function (response) {
          if (response.status.success == "true") {
            conc_playlists = (response.list ? response.list : {});
            conc_playlist(response.playlist.id);
            $('#playlistmodal').closeModal();
            $('#playlistmodal-existing').fadeTo(0,1);
            $('#playlistmodal-new').fadeTo(0,1);
          }
        }
      });

    }
  });
}

// remove from playlist

conc_unplaylistperformance = function (wid, aid, set, pid) {
  $.ajax({
    url: conc_options.backend + '/dyn/recording/unplaylist/',
    method: "POST",
    data: { id: localStorage.user_id, wid: wid, aid: aid, set: set, pid: pid, auth: conc_authgen() },
    success: function (response) {
      if (response.status.success == "true") {
        conc_playlists = (response.list ? response.list : {});
        conc_playlist(pid);
        $('#playlistmodal').closeModal();
      }
    }
  });
}

// renaming and deleting playlists

conc_editplaylist = function () {

  window.editplaylist = $('#favtitle select option:checked').val();
  $('#tuning-modal').hide();

  for (pllst in conc_playlists) {
    if (conc_playlists[pllst].id == window.editplaylist) {
      playlist_owner = conc_playlists[pllst].owner;
    }
  }

  if (playlist_owner == localStorage.user_id) {
    $('#playlist_newname').val($('#favtitle select option:checked').text());
    $('#toggle_delpl').toggles(false);
    $("#editplaylistmodal").leanModal();
  }
  else {
    $('#playlist_dupname').val($('#favtitle select option:checked').text());
    $('#toggle_unsubpl').toggles(false);
    $("#unsubscribemodal").leanModal();
  }
}

conc_renameplaylist = function () {

  if ($('#playlist_newname').val()) {
    $.ajax({
      url: conc_options.backend + '/dyn/playlist/rename/',
      method: "POST",
      data: { id: localStorage.user_id, pid: window.editplaylist, name: $('#playlist_newname').val(), auth: conc_authgen() },
      success: function (response) {
        if (response.status.success == "true") {
          conc_playlists = (response.list ? response.list : {});
          conc_playlist(window.editplaylist);
          $('#editplaylistmodal').closeModal();
        }
      }
    });
  }
}

conc_deleteplaylist = function () {
  $.ajax({
    url: conc_options.backend + '/dyn/playlist/delete/',
    method: "POST",
    data: { id: localStorage.user_id, pid: window.editplaylist, auth: conc_authgen() },
    success: function (response) {
      if (response.status.success == "true") {
        conc_playlists = (response.list ? response.list : {});
        conc_playlist("fav");
        $('#editplaylistmodal').closeModal();
        $('#toggle_delpl').toggles(false);
      }
    }
  });
}

// importing and unsubscribing playlists

conc_importplaylist = function (name) {
  $.ajax({
    url: conc_options.backend + '/dyn/user/playlist/duplicate/',
    method: "POST",
    data: { name: name, id: localStorage.user_id, pid: window.editplaylist, auth: conc_authgen() },
    success: function (response) {
      if (response.status.success == "true") {
        window.newplaylist = response.playlist.id;
        conc_gounsubplaylist(window.editplaylist, function (response) {
          conc_playlists = (response.list ? response.list : {});
          conc_playlist(window.newplaylist);
          $('#unsubscribemodal').closeModal();
        });
      }
    }
  });
}

conc_subplaylist = function (pid) {
  $.ajax({
    url: conc_options.backend + '/dyn/user/playlist/subscribe/',
    method: "POST",
    data: { id: localStorage.user_id, pid: pid, auth: conc_authgen() },
    success: function (response) {
      if (response.status.success == "true") {
        conc_playlists = (response.list ? response.list : {});
        conc_playlist(pid);
      }
    }
  });
}

conc_unsubplaylist = function () {
  conc_gounsubplaylist(window.editplaylist, function (response) {
    if (response.status.success == "true") {
      conc_playlists = (response.list ? response.list : {});
      conc_playlist("fav");
      $('#unsubscribemodal').closeModal();
      $('#toggle_unsubpl').toggles(false);
    }
  });
}

conc_gounsubplaylist = function (pid, action) {
  $.ajax({
    url: conc_options.backend + '/dyn/user/playlist/unsubscribe/',
    method: "POST",
    data: { id: localStorage.user_id, pid: pid, auth: conc_authgen() },
    success: action
  });
}

// playlist detail

conc_playlistdetail = function (pid) {

  $.ajax({
    url: conc_options.backend + '/recording/list/playlist/' + pid + '.json',
    method: "GET",
    success: function (response) {
      docsr = response.recordings;

      window.playlistid = pid;

      $('#playlistdetail').hide();
      $('#playlistdetail .unsubscribe').hide();
      $('#playlistdetail .subscribe').show();
      $('#playlistradio').show();

      $('#genres').css("display", "none");
      $('#works').css("display", "none");
      $('#searchbywork').css("display", "none");

      $('#albums').addClass('playlist');
      $('#albums').html('');
      $('#genresworks h2').html('playlist');
      $('#genresworks h3').html(response.playlist.name);
      $('#genresworks h4').html(`by <a href="https://open.spotify.com/user/${response.playlist.owner.id}">${response.playlist.owner.name}</a>`);

      for (pllst in conc_playlists) {
        if (conc_playlists[pllst].id == pid) {
          $('#playlistdetail .subscribe').hide();
          $('#playlistdetail .unsubscribe').show();
        }
      }

      if (response.playlist.owner.id != localStorage.user_id) {
        $('#playlistdetail').show();
      }

      for (performance in docsr) {
        listul = '#albums';
        draggable = "";
        pidsort = "";

        $(listul).append('<li pid="' + docsr[performance].work.id + '-' + docsr[performance].apple_albumid + '-' + docsr[performance].set + '" class="performance"><ul>' + conc_recordingitem(docsr[performance], docsr[performance].work, response.playlist) + '</ul></li>');
      }
    }
  });
}

// new radio

conc_newradio = function (filter) {
  if (filter.genre) {
    if (filter.genre.toLowerCase() == 'popular') filter.popularwork = 1;
    if (filter.genre.toLowerCase() == 'recommended') filter.recommendedwork = 1;
    if (filter.genre.toLowerCase() == 'fav') filter.work = 'fav';  
    if (filter.genre.toLowerCase() == 'recommended' || filter.genre.toLowerCase() == 'popular' || filter.genre.toLowerCase() == 'fav' || filter.genre.toLowerCase() == 'all') filter.genre = '';  
  }
  if (conc_disabled) {
    $(`#${conc_disabledreason}`).leanModal(); return;
  }
  $.ajax({
    url: conc_options.backend + '/dyn/user/work/random/',
    method: "POST",
    data: { id: localStorage.user_id, popularcomposer: filter.popularcomposer, recommendedcomposer: filter.recommendedcomposer, popularwork: filter.popularwork, recommendedwork: filter.recommendedwork, genre: filter.genre, epoch: filter.epoch, composer: filter.composer, work: filter.work },
    success: function (response) {
      if (response.status.success == "true") {

        conc_radioqueue = [];
        for (wk in response.works)
        {
          conc_radioqueue.push(response.works[wk]);
        }

        conc_onair = true;
        conc_radiofilter = filter;
        conc_radiofilter.type = 'radio';

        if (!$('#tuning-modal').is(':visible')) { $('#tuning-modal').leanModal(); }

        $('#radiotop #goradio').removeClass('on');
        $('#radiotop #goradio').addClass('on');

        $('body').addClass('radioonair');

        $('#playercontrols #skip').removeClass('radio');
        $('#playercontrols #skip').addClass('radio');

        $('#radiotop select').prop("disabled", true);

        conc_randomrecording (conc_radioqueue.shift().id);
      }
    }
  });
}

// radio skip

conc_radioskip = function () {
  //console.log('Over, next'); 
  if (conc_onair) {
    if (conc_radioqueue.length) {
      if (Object.keys(conc_state).length > 0 && !conc_state.paused) {
        applemusic.player.pause();
      }
      if (!$('#tuning-modal').is(':visible')) { $('#tuning-modal').leanModal(); }
      if (conc_radiofilter.type == 'playlist') {
        var thisrec = conc_radioqueue.shift();
        thisrec = thisrec.split('-');
        conc_recording (thisrec[0], thisrec[1], thisrec[2]);
      }
      else {
        conc_randomrecording(conc_radioqueue.shift().id);
      }
    }
    else {
      if (conc_radiofilter.type == 'playlist') {
        conc_radiobutton();
      }
      else {
        conc_newradio (conc_radiofilter);
      }
    }
  }
}

// radio button

conc_radiobutton = function () {
  if (conc_disabled) {
    $(`#${conc_disabledreason}`).leanModal(); return;
  }
  $('#radiotop #goradio').toggleClass('on');
  $('#playercontrols #skip').toggleClass('radio');

  if ($('#radiotop #goradio').hasClass('on')) {
    filter = { genre: $('#radiotop select.genres option:checked').val(), epoch: $('#radiotop select.periods option:checked').val() };
    if ($('#radiotop select.composers option:checked').val() == "wfav") {
      filter.work = "fav";
    }
    else if ($('#radiotop select.composers option:checked').val() == "wrec") {
      filter.recommendedwork = "1";
    }
    else if ($('#radiotop select.composers option:checked').val() == "rec") {
      filter.recommendedcomposer = "1";
    }
    else if ($('#radiotop select.composers option:checked').val() == "wpop") {
      filter.popularwork = "1";
    }
    else if ($('#radiotop select.composers option:checked').val() == "pop") {
      filter.popularcomposer = "1";
    }
    else {
      filter.composer = $('#radiotop select.composers option:checked').val();
    }
    conc_newradio(filter);
  }
  else {
    conc_radioqueue = [];
    conc_radiofilter = {};
    conc_onair = false;
    $('body').removeClass('radioonair');
    $('#radiotop select').prop("disabled", false);
  }
}

// playlist radio

conc_playlistradio = function (where) {

  if (conc_disabled) {
    $(`#${conc_disabledreason}`).leanModal(); return;
  }

  var performances = $(where).children().get();
  var pids = [];

  for (p in performances) {
    pids[p] = $(performances[p]).attr("pid");
  }

  if (pids.length)
  {
    for (let i = pids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pids[i], pids[j]] = [pids[j], pids[i]];
    }

    conc_onair = true;
    conc_radioqueue = pids;
    conc_radiofilter = { type: 'playlist' };

    if (!$('#tuning-modal').is(':visible')) { $('#tuning-modal').leanModal(); }

    $('#radiotop #goradio').removeClass('on');
    $('#radiotop #goradio').addClass('on');
    $('body').addClass('radioonair');

    $('#playercontrols #skip').removeClass('radio');
    $('#playercontrols #skip').addClass('radio');

    $('#radiotop select').prop("disabled", true);

    var thisrec = pids.shift();
    thisrec = thisrec.split("-");
    conc_recording (thisrec[0], thisrec[1], thisrec[2]);
  }
}

// permalink

conc_permalink = function (wid, aid, set) {
  $('#sharedialog').show();
  $('#shareconfirm').hide();

  $.ajax({
    url: conc_options.backend + '/recording/shorturl/work/' + wid + '/album/' + aid + '/' + set + '.json',
    method: "GET",
    success: function (response) {
      permauri = conc_options.shareurl + '/r/' + (Number(response.recording.id)).toString(16);
      $('#permalink-direct').val(permauri);
      $('#permalink-widget').text(`<iframe src="${permauri}/widget" width="593" height="420" frameborder="0" style="border-radius:24px"></iframe>`);
      $('#permalink-modal').leanModal();
    }
  });
}

conc_linkcopy = function (obj) {
  fobj = $(`#permalink-${obj}`);
  fobj.select();
  document.execCommand("copy");
  $('#sharedialog').hide();
  $('#shareconfirm').show();
}

// refreshing the composer list

conc_refreshcomposers = function () {
  if ($('#composers li.index').hasClass('all')) {
    conc_composersbyname('all');
  }
  else if ($('#composers li.index').hasClass('favorite')) {
    conc_composersbyfav();
  }
  else if ($('#composers li.index').hasClass('period')) {
    conc_composersbyepoch($('#library .periods').val());
  }
  else {
    conc_composersbyname($('#composers li.index').html());
  }
}

// album pagination by scrolling

conc_albumscroll = function (o) {
  if (o.offsetHeight + o.scrollTop > o.scrollHeight - 400) {
    if (window.albumlistnext) {
      if (window.albumlistnext != window.albumlistoffset) {
        conc_recordingsbywork(window.albumlistwork, window.albumlistnext);
      }
    }
  }
}

// recording tagging

conc_qualify = function () {
  $('#playerverify').toggleClass('opened');
}

// mobile pagination

conc_mobilepage = function (page) {
  if ($(window).width() < 1024) {
    if (window.location.hash != '#' + page) {
      window.history.pushState({}, 'Concertino', window.location.pathname.split('#')[0] + '#' + page);
    }
  
    if (page == 'player') { 
      $('#nowplaying').removeClass().addClass('down');
      $('body').addClass('player');
    } else {
      $('body').removeClass('player library favorites radio settings composer work').addClass(page);
    }
  }
}

// mobile swipe detection

conc_swipedetect = function (el, callback) {
  // http://javascriptkit.com/javatutors/touchevents2.shtml
  var touchsurface = el,
  swipedir,
  startX,
  startY,
  distX,
  distY,
  threshold = 10, //required min distance traveled to be considered swipe
  restraint = 1000, // maximum distance allowed at the same time in perpendicular direction
  allowedTime = 10000000, // maximum time allowed to travel that distance
  elapsedTime,
  startTime,
  handleswipe = callback || function(swipedir){}

  touchsurface.addEventListener('touchstart', function(e){
      var touchobj = e.changedTouches[0]
      swipedir = 'none'
      dist = 0
      startX = touchobj.pageX
      startY = touchobj.pageY
      startTime = new Date().getTime() // record time when finger first makes contact with surface
      //e.preventDefault()
  }, false)

  touchsurface.addEventListener('touchmove', function(e){
      //e.preventDefault() // prevent scrolling when inside DIV
  }, false)

  touchsurface.addEventListener('touchend', function(e){
      var touchobj = e.changedTouches[0]
      distX = touchobj.pageX - startX // get horizontal dist traveled by finger while in contact with surface
      distY = touchobj.pageY - startY // get vertical dist traveled by finger while in contact with surface
      
      elapsedTime = new Date().getTime() - startTime // get time elapsed
      if (elapsedTime <= allowedTime){ // first condition for awipe met
          if (Math.abs(distX) >= threshold && Math.abs(distY) <= restraint){ // 2nd condition for horizontal swipe met
              swipedir = (distX < 0)? 'left' : 'right' // if dist traveled is negative, it indicates left swipe
          }
          else if (Math.abs(distY) >= threshold && Math.abs(distX) <= restraint){ // 2nd condition for vertical swipe met
              swipedir = (distY < 0)? 'up' : 'down' // if dist traveled is negative, it indicates up swipe
          }
      }
      handleswipe(swipedir)
      //e.preventDefault()
  }, false)
}

// settings screen: patrons listing

conc_settings = function (mode) {

  $.ajax({
    url: conc_options.opusbackend + '/patron/list.json',
    method: "GET",
    success: function (response) {

      if (response.status.rows >= 1) {
        ulpatrons = $('#patrons ul');
        ulpatrons.empty();

        for (patron in response.patrons) {
          ulpatrons.append(`<li>${response.patrons[patron]}</li>`);
        }

        $('#patrons').removeClass('hidden');
      }
      
      switch (mode) {
        case "desktop":
          $('#config').leanModal();
          break;
        case "mobile":
          conc_mobilepage('settings');
          break;
      }
    }
  });

}